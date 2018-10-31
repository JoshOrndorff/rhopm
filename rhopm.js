const { RNode, simplifiedKeccak256Hash } = require('rchain-api');
const grpc = require('grpc');
const { readFileSync } = require('fs');

// TODO parse these options with docopt
// For now assume this command:
// rhopm deploy fourth.rho
const deployPath = "./fourth.rho";

// Setup globals
const exportTemplate = readFileSync('exportTemplate.rho', 'utf8');
const importTemplate = readFileSync('importTemplate.rho', 'utf8');
const dependencyGraph = {};
const deployedURIs = {}; // A map from hash-name combos to registry URIs
                         // TODO save this one to disk afterward.
                         // TODO save this to the blockchain using something like Stay's code
const myNode = RNode(grpc, { host: "localhost", port: 40401 });


// Build dependency graph starting from a single deploy, and empty graph
buildGraph(deployPath, dependencyGraph);
//console.log("Final Dependency Graph:");
//console.log(dependencyGraph);

// Traverse dependency graph, deploying as necessary
let toDeploy = new Set(Object.keys(dependencyGraph));
deployAll(toDeploy, dependencyGraph, deployedURIs, myNode).then(() => {
  console.log("\n\nFinal Deploy locations:");
  console.log(deployedURIs);
});


//TODO Update .rhopm.json file (so far its all in memory)

/////////////// END MAIN //////////////////////

/**
 * Deploys all code in toDeploy in as few blocks as possible
 * ensuring dependencies are met in advance
 * @param toDeploy Set of hashes or code to be deployed
 * @param fullGraph Complete dependency graph (will not be mutated)
 * @param deployed Map from hashes to registry URIs
 * @param myNode The node to deploy to
 */
function deployAll(toDeploy, fullGraph, deployedURIs, myNode) {
  console.log("\n\nEntering deployAll. Files to deploy: " + toDeploy.size + " deployedURIs are:");
  console.log(deployedURIs);

  // Terminate the recursion
  if (toDeploy.size === 0) {
    return new Promise(() => 0);
  }

  // Find all deploys that have no unmet dependencies
  const deployPromises = [];
  const deployedHashes = [];
  for (let hash of toDeploy) {
    console.log("IN HERE!!!!" + fullGraph[hash].path)

    // If it's already deployed, call it done
    if (deployedURIs.hasOwnProperty(hash)) {
      toDeploy.delete(hash);
      continue;
    }
    console.log("not already deployed")
    // If it still has unmet depends, skip it.
    let ready = true;
    for (let depend of Object.keys(fullGraph[hash].depends)) {
      let source = fullGraph[hash].depends[depend];
      if (!deployedURIs.hasOwnProperty(source)) {
        ready = false;
        break;
      }
    }
    if (!ready){
      console.log("not ready yet");
      continue;
    }

    // This one is eligible, so move it from do to done
    toDeploy.delete(hash);
    deployedHashes.push(hash);

    // Render all the imports
    let term = fullGraph[hash].code;
    for (let dependName in fullGraph[hash].depends) {
      let dependHash = fullGraph[hash].depends[dependName];
      let dependURI = deployedURIs[dependHash][dependName];
      term = importTemplate
              .replace("XXXX", dependURI)
              .replace("YYYY", dependName)
              .replace("ZZZZ", term);
    }

    console.log("About to deploy code:")
    console.log(term)

    // Now deploy it
    const deployData = {
      term,
      timestamp: (new Date()).valueOf(),
      phloLimit: { value: 9999999 },
      phloPrice: { value: 1 },
      from: "0x01",
    }

    deployPromises.push(myNode.doDeploy(deployData));
    deployedURIs[hash] = {};
    console.log("started deploy of " + fullGraph[hash].path);
  }

  // Once all the deploys are done, create a block and wait for uris
  return Promise.all(deployPromises).then(() => {
    return myNode.createBlock();
  }).then( msg => {
    console.log(msg)

    // Lookup all the just-deployed URIs and put them in deployed map
    let uriPromises = [];
    for (let hash of deployedHashes) {
      for (let name of fullGraph[hash].exports) {
        let fullName = hash + name;
        let uriPromise = myNode.listenForDataAtPublicName(fullName);
        uriPromises.push(uriPromise);
        uriPromise.then( blockResults => {
          let uri = blockResults[0].postBlockData[0].exprs[0].g_uri;
          console.log("uri for " + fullName + " was: " + uri);
          // Update the deployed map
          deployedURIs[hash][name] = uri;
        });
      }

    }
    // When all the updates to the map are done, we can start the next round
    console.log(`waiting for ${uriPromises.length} uris`)
    return Promise.all(uriPromises).then(() => {
      console.log("all resolved. About to start next round.")
      deployAll(toDeploy, fullGraph, deployedURIs, myNode);
    });
  })
}










/**
 * Recursively calculates dependency graph for given deploy.
 * Assumes imports are in the widest scope (listed at the beginning of the file).
 * @param deployPath String representing a module to deploy
 * @param graph A partially complete dependency graph to build on
 * @return The hash of the code from the deployPath
 */
function buildGraph(deployPath, graph) {

  // Read package's contents
  const rawCode = readFileSync(deployPath, 'utf8');

  // Hash and check whether it's already in the graph
  const hash = simplifiedKeccak256Hash(rawCode);
  if (graph.hasOwnProperty(hash)) {
    return hash;
  }

  // Make blank entry in dependency graph
  // and temporary depends holder for imports where paths are given
  // TODO eventually support importing by code hash
  const dependsPaths = {};
  graph[hash] = {
    path: deployPath,
    depends: {},
    exports: [],
    code: undefined,
  }

  // Split raw code into lines
  let lines = rawCode.split('\n');

  // Iterate through the lines of the program
  for (let i = 0; i < lines.length; i++) {
    const exportIndent = lines[i].indexOf("// export");
    const importIndent = lines[i].indexOf("// import");

    if (exportIndent !== -1) { // if this line is an export
      //TODO Support no bundle at all? maybe syntax would be export9{whatever} because 9 is the opposite of 0
      //TODO should the actual text replacement happen later?
      const mode = (lines[i].charAt(9 + exportIndent) === '{') ? "" : lines[i].charAt(9 + exportIndent);
      const openBrace = lines[i].indexOf("{");
      const closeBrace = lines[i].indexOf("}");
      const name = lines[i].slice(openBrace + 1, closeBrace);
      lines[i] = exportTemplate.replace("XXXX", `bundle${mode}{*${name}}`).replace("YYYY", hash + name);

      // Add export to graph
      graph[hash].exports.push(name);
    }

    if (importIndent !== -1) { // if this line is an import
      // Parse the import line
      const openBracket = lines[i].indexOf('[');
      const closeBracket = lines[i].indexOf(']');
      const closeBrace = lines[i].indexOf('}');
      const dependPath = lines[i].slice(importIndent + 10, closeBrace);
      const dependName = lines[i].slice(openBracket + 1, closeBracket);

      // Remove import line from code
      lines[i] = '';

      // Add dependency to graph
      dependsPaths[dependName] = dependPath;
    }
  }

  // Put the lines back together
  graph[hash].code = lines.join('\n');

  // Recurse through each dependency
  //TODO figure out what to do for dependencies that are specified by hash
  for (let dependName in dependsPaths) {
    let dependPath = dependsPaths[dependName];
    let childHash = buildGraph(dependPath, graph);
    graph[hash].depends[dependName] = childHash;
  }
  return hash;
}







/**
 * Takes in a piece of rholang code, and replaces all exports with registry inserts
 * @param raw Rholang code including 0 or more exports
 * @return The same rholang with the exports replaced
 */
function replaceExports(raw, hash) {


}

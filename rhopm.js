const { RNode, simplifiedKeccak256Hash } = require('rchain-api');
const grpc = require('grpc');
const path = require('path');
const { docopt } = require('docopt');
const { readFileSync, writeFileSync } = require('fs');

// Setup docopt
const usage = `
Deploy packages and their dependencies to a target blockchain

Usage:
  main.js [options]

Options:
 --host STRING               The hostname or IPv4 address of the node
                             [default: localhost]
 --port INT                  The tcp port of the nodes gRPC service
                             [default: 40401]
 --package STRING            Path to a package to deploy
 --directory-file STRING     Path to a file containing directory of deployed URIs
 --directory-contract URI    URI of onchain directory of deployed URIs
 -h --help                   show usage
`;
const cli = docopt(usage, { argv: process.argv.slice(2) });

// Setup globals
const exportTemplate = readFileSync(path.join(__dirname, 'exportTemplate.rho'), 'utf8');
const importTemplate = readFileSync(path.join(__dirname, 'importTemplate.rho'), 'utf8');
const { loadURIs, saveURIs } =
  makeLoadSave(cli['--directory-file'], cli['--directory-contract']);
const deployedURIs = loadURIs();
const myNode = RNode(grpc, { host: cli['--host'], port: cli['--port'] });


// Build dependency graph starting from a single deploy, and empty graph
//TODO take a parameter for whether to build the entire thing, or trunctace
// when reaching package nodes that are already deployed.
let dependencyGraph = buildGraph(cli['--package'], deployedURIs);
//console.log("Final Dependency Graph:");
//console.log(dependencyGraph);

// Traverse dependency graph, deploying as necessary
//TODO figure out how to use await here
let toDeploy = new Set(Object.keys(dependencyGraph));
deployAll(toDeploy, dependencyGraph, deployedURIs, myNode).then(() => {

  console.log("\n\nFinal Deploy locations:");
  console.log(deployedURIs);

  // Save directory to file (or, in the future, an on-chain contract)
  saveURIs(deployedURIs);
});





/////////////// END MAIN //////////////////////


/**
 * Creates a functions to load and save the deployment directory to file or,
 * in the future blockchain/
 * @param file Path to a directory file to keep updated
 * @param contract URI of a directory contract to keep updated
 * @return An boject containing loadURIs and saveURIs functions
 */
function makeLoadSave(file, contract) {

  // No directory specified. State is totally transient
  if (file == undefined && contract == undefined) {
    return {
      loadURIs: () => { return {} },
      saveURIs: () => {
        console.warn("Deployment directory not saved. No file or contract supplied.")
      },
    };
  }

  if (contract) {
    console.warn("Directory contracts not yet supported. Ignoring supplied URI.");
  }

  function loadURIs() {
    try {
      return require(path.join(__dirname, file));
    }
    catch {
      console.warn(`Failed to read file ${file}. Starting with blank state.`);
      return {};
    }
  }

  function saveURIs(newDirectoryState) {
    writeFileSync(file, JSON.stringify(newDirectoryState));
  }

  return { loadURIs, saveURIs };
}




/**
 * Deploys all code in toDeploy in as few blocks as possible
 * ensuring dependencies are met in advance
 * @param toDeploy Set of hashes of code to be deployed
 * @param fullGraph Complete dependency graph (will not be mutated)
 * @param deployedURIs Map from deployed code hashes to registry URIs
 * @param myNode The node to deploy to
 * @return A promise (for what?)
 */
async function deployAll(toDeploy, fullGraph, deployedURIs, myNode) {
  console.log("\n\nEntering deployAll. Files to deploy: " + toDeploy.size + "\n deployedURIs are:");
  console.log(deployedURIs);
  console.log("toDeploy is:");
  console.log(toDeploy);

  // Terminate the recursion
  if (toDeploy.size === 0) {
    return new Promise((resolve, reject) => {
      resolve('Finished deploying all packages');
    });
  }

  // Find all deploys that have no unmet dependencies
  const deployPromises = [];
  const deployedHashes = [];
  for (let hash of toDeploy) {

    // If it still has unmet depends, skip it.
    let ready = true;
    for (let depend of Object.keys(fullGraph[hash].depends)) {
      let source = fullGraph[hash].depends[depend];
      //PROBLEM!!!!!!!!! Fourth should have a dependency on square
      // and square should not yet be in deployedURIs
      if (!deployedURIs.hasOwnProperty(source)) {
        ready = false;
        break;
      }
    }
    if (!ready){
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
              .replace(/YYYY/g, dependName)
              .replace("ZZZZ", term);
    }

    //console.log("About to deploy code:")
    //console.log(term)

    // Now deploy it
    const deployData = {
      term,
      timestamp: (new Date()).valueOf(),
      phloLimit: { value: 9999999 },
      phloPrice: { value: 1 },
      from: "0x01",
    }

    deployPromises.push(myNode.doDeploy(deployData));
    console.log("started deploy of " + fullGraph[hash].path);
  }

  // Once all the deploys are done, create a block and update the deployedURIs
  await Promise.all(deployPromises);
  console.log("All deploy promises completed");
  const proposeMessage = await myNode.createBlock();
  console.log(proposeMessage);
  deployedHashes.map((hash) => { deployedURIs[hash] = {} });

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
  await Promise.all(uriPromises);
  console.log("all resolved. About to start next round.");
  return deployAll(toDeploy, fullGraph, deployedURIs, myNode);
}










/**
 * Calculates dependency graph for given deploy.
 * Assumes imports are in the widest scope (listed at the beginning of the file).
 * @param deployPath String representing a module to deploy
 * @param directory A directory of code to be considered already deployed
 * @return The completed graph
 */
function buildGraph(primaryDeployPath, directory={}) {

  // Calculate the portion of the dependency graph that needs to be deployed
  const graph = {};
  buildRecursive(primaryDeployPath);
  return graph;

  /**
   * Internal helper
   * Recursively calculates dependency graph for given deploy.
   * Assumes presence partially-completed mutable graph.
   * @param deployPath String representing a module to deploy
   * @return The hash of the code from the deployPath
   */
  function buildRecursive(deployPath) {

    // Read package's contents
    const rawCode = readFileSync(deployPath, 'utf8');

    // Check whether it's already in the graph or the directory
    const hash = simplifiedKeccak256Hash(rawCode);
    if ((deployPath !== primaryDeployPath) && (graph.hasOwnProperty(hash) || directory.hasOwnProperty(hash))) {
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
    const relativeDirectory = path.dirname(deployPath);
    for (let dependName in dependsPaths) {
      const relativeDependPath = path.join(relativeDirectory, dependsPaths[dependName]);
      const childHash = buildRecursive(relativeDependPath);
      graph[hash].depends[dependName] = childHash;
    }
    return hash;
  }
}







/**
 * Takes in a piece of rholang code, and replaces all exports with registry inserts
 * @param raw Rholang code including 0 or more exports
 * @return The same rholang with the exports replaced
 */
function replaceExports(raw, hash) {


}

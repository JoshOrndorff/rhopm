const { RNode, simplifiedKeccak256Hash } = require('rchain-api');
const grpc = require('grpc');
const { readFileSync } = require('fs');

// TODO parse these options with docopt
// For now assume this command:
// rhopm deploy square.rho
const deployPath = "square.rho";

// Setup globals
const insertTemplate = readFileSync('exportTemplate.rho', 'utf8');
const myNode = RNode(grpc, { host: "localhost", port: 40401 });

// Open the file and read the contents
const rawCode = readFileSync(deployPath, 'utf8');
console.log("raw code:\n");
console.log(rawCode);

// Hash and check whether already registered
const hash = simplifiedKeccak256Hash(rawCode);
console.log("hash: " + hash)
//TODO check whether already registered

// Replace any exports with registry code
const term = replaceExports(rawCode, hash);
console.log("full term:\n");
console.log(term);

// Deploy
const deployData = {
  term,
  timestamp: (new Date()).valueOf(),
  phloLimit: { value: 9999999 },
  phloPrice: { value: 1 },
  from: "0x01",
}
myNode.doDeploy(deployData);
console.log("past deploy");

// When all deploys have finished, propose
//TODO something about promise.all

// Grab URI

// Update .rhopm.json

/**
 * Takes in a piece of rholang code, and replaces all exports with registry inserts
 * @param raw Rholang code including 0 or more exports
 * @return The same rholang with the exports replaced
 */
function replaceExports(raw, hash) {

  // Split raw code into lines
  let lines = raw.split('\n');
  console.log("number of lines: " + lines.length);

  // Replace each export
  for (let i = 0; i < lines.length; i++) {
    const indent = lines[i].indexOf("// export");
    console.log("indent:" + indent);
    if (indent === -1) {
      continue
    }
    //TODO Support no bundle at all?
    const mode = (lines[i].charAt(9 + indent) === '{') ? "" : lines[i].charAt(9 + indent);
    const openBrace = lines[i].indexOf("{")
    const closeBrace = lines[i].indexOf("}")
    const name = lines[i].slice(openBrace + 1, closeBrace)
    lines[i] = insertTemplate.replace("XXXX", `bundle${mode}{*${name}}`).replace("YYYY", hash + name)
  }

  // Put it back together
  return lines.join('\n');
}

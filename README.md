# Rholang Package Manager

This project is in its _very_ early stages of development. It strives to allow a modular package ecosystem for rholang programmers. Through `import` and `export` syntax embedded in rholang comments, the programmer can signal the package managers what dependencies are required, where to find those dependencies, and what contracts are made available. The package manager dynamically calculates the dependency graph, deploys all dependencies in as few blocks as possible, and

## Usage
* Start an RNode running casper
* Clone this repo
* cd into the directory
* run the example deploy `node rhopm.js powers.rho`
* Figure out why the last deploy promise resolves right before the last round. grrrr.

# Missing features
* Store a record of deployed code to disk to avoid re-deployments
* Store a record of deployed code on chain so common libraries can be taken for granted
* Lookup import names in the registry concurrently
* Any semblance of error or edge case handling

# Author and License

Written by Joshy Orndorff

Apache 2.0 License

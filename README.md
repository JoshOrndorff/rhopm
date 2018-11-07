# Rholang Package Manager

This project is in its very early stages of development. It strives to facilitate a modular package ecosystem for rholang programmers.

Through `import` and `export` syntax embedded in rholang comments, programmers signal the package manager what dependencies are required, and where to find those dependencies. The package manager dynamically calculates the dependency graph and deploys all dependencies in as few blocks as possible.

## Example
It is probably easiest to see how rhopm works by checking out the [example project](exampleProject/README.md)

## Syntax
To export a name (likely a contract) use one of these syntaxes
 * `// export+{name}` for a write-only bundle of name
 * `// export-{fourth}` for a read-only bundle of name
 * `// export0{fourth}` for a no-read-write bundle of name
 * `// export{fourth}` for a read-write bundle of name

 To import a name use this syntax
 * `// import{./file.rho}[name]` to import name from file.rho

## Usage
* Start an RNode running casper
* Clone this repo
* Write a project using the syntax above
* Deploy your project with `node <path to rhopm.js> --package <path to project>`

## Missing Features
* Store a record of deployed code to disk to avoid re-deployments
* Store a record of deployed code on chain so common libraries can be taken for granted
* Lookup import names in the registry concurrently
* Any semblance of error or edge case handling

## Author and License

Written by Joshy Orndorff

Apache 2.0 License

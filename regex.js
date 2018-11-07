const exportString = "  // export+{cube}";
//TODO why does "  // export8{cube}" still match with a mode of 8?
// export88 doesn't match


// Beginning of string
// Zero or more whitespace (tab or space) characters
// // export
// A mode 0, -, +, none, =         // = is for no bundle
// A brace
// A name to export (at least one letter followed by zero or more alphanumerics)
// A closing brace
// Zero or more whitespace characters
// End of the string
const exportRegex =
  /^[ \t]*\/\/ export(?<mode>[0+-=]?)\{(?<name>[a-zA-Z][a-zA-Z0-9]*)\}[ \t]*$/;

const { mode, name } = exportRegex.exec(exportString).groups;
console.log("mode: " + mode);
console.log("name: " + name);

//////////////////////////////////////////////////////////////////////////////

const importString = "// import{./square.rho}[square]";
// Beginning of string
// Zero or more whitespace (tab or space) characters
// // import
// A brace
// A path to import from
// A closing brace
// A square bracket
// A name to import (at least one letter followed by zero or more alphanumerics)
// A closing square bracket
// Zero or more whitespace characters
// End of the string
const importRegex =
  /^[ \t]*\/\/ import\{(?<source>.*)\}\[(?<name2>[a-zA-Z][a-zA-Z0-9]*)\][ \t]*$/;

const { source, name2 } = importRegex.exec(importString).groups;
console.log("source: " + source);
console.log("name: " + name2);

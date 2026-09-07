'use strict';

// Compatibility replacement for the deprecated standalone lodash.isequal package.
// Delegate to the maintained lodash implementation so equality semantics remain
// Lodash-compatible instead of substituting Node's stricter deep equality rules.
module.exports = require('lodash/isEqual');

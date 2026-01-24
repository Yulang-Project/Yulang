// src/generator/lang_items.ts

// This file defines mappings for "lang items" - special types and functions
// that the compiler needs to know about for core language features.

export const LangItems = {
    string: {
        typeName: 'string', // The Yu type name
        structName: '%struct.string', // The LLVM struct name
        className: 'string', // The class name in std.yu (for the wrapper class)
        module: 'std', // The module it belongs to
        members: { // Re-add members for internal compiler use
            ptr: { index: 0, type: 'i8*' },
            len: { index: 1, type: 'i64' },
        }
    },
    builtin_alloc: { // New lang item for _builtin_alloc
        symbolName: 'malloc', // Underlying C function for allocation
        module: 'builtin', // A pseudo-module for builtins
    }, // Add comma
    string_add: {
        symbolName: '__string_add', // The function name in std.yu for the '+' operator on strings
        module: 'std',
    },
    object: {
        typeName: 'object',
        structName: '%struct.object',
    }
    // Future lang items can be added here, e.g., for arrays, memory allocation, etc.
};

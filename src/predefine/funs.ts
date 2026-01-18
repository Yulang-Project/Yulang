import { BuiltinFunctions } from '../generator/builtins.js';
import { IRGenerator, type IRValue } from '../generator/ir_generator.js';
import { LangItems } from '../generator/lang_items.js';
import { type PredefinedFunction, type PredefinedFunctionHandler } from './types.js';

const BUILTIN_FUNCTIONS: PredefinedFunction[] = [
    {
        name: 'objof',
        handler: (generator, args) => {
            if (args.length !== 1) {
                throw new Error("objof requires exactly one argument: address (i64).");
            }
            const addr = args[0]!;
            
            if (addr.type !== 'i64') {
                throw new Error("objof argument must be an integer address (i64).");
            }

            // The sole purpose of objof is to turn an integer into a generic pointer ("reference").
            // The 'as' operator will then handle the dereferencing.
            const ptr = generator.llvmHelper.getNewTempVar();
            generator.emit(`${ptr} = inttoptr i64 ${addr.value} to i8*`);
            return { value: ptr, type: 'i8*' };
        }
    },
    {
        name: '_builtin_alloc',
        handler: (generator, args) => {
            if (args.length !== 1) {
                throw new Error("_builtin_alloc requires exactly one argument: size (i64).");
            }
            const sizeArg = args[0];
            if (!sizeArg || sizeArg.type !== 'i64') {
                throw new Error("_builtin_alloc argument must be of type i64.");
            }
            generator.ensureHeapGlobals();
            const ptr = generator.llvmHelper.getNewTempVar();
            generator.emit(`${ptr} = call i8* @yulang_malloc(i64 ${sizeArg.value})`);
            return { value: ptr, type: 'i8*' };
        }
    },
    {
        name: '_builtin_string_to_ptr',
        handler: (generator, args) => {
            if (args.length !== 1) {
                throw new Error("_builtin_string_to_ptr requires exactly one argument: string.");
            }
            const stringArg = args[0];
            if (!stringArg || stringArg.type !== `${LangItems.string.structName}*`) {
                throw new Error("_builtin_string_to_ptr argument must be of type string.");
            }
            const stringPtr = stringArg.value; // %struct.string* (already pointer)
            const dataPtrVar = generator.llvmHelper.getNewTempVar();
            const ptrGep = generator.llvmHelper.getNewTempVar();
            generator.emit(`${ptrGep} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${stringPtr}, i32 0, i32 0`);
            generator.emit(`${dataPtrVar} = load i8*, i8** ${ptrGep}, align 8`);
            return { value: dataPtrVar, type: 'i8*' };
        }
    },
    {
        name: '_builtin_string_get_len',
        handler: (generator, args) => {
            if (args.length !== 1) {
                throw new Error("_builtin_string_get_len requires exactly one argument: string.");
            }
            const stringArg = args[0];
            if (!stringArg || stringArg.type !== `${LangItems.string.structName}*`) {
                throw new Error("_builtin_string_get_len argument must be of type string.");
            }
            const stringPtr = stringArg.value; // %struct.string*
            const lenVar = generator.llvmHelper.getNewTempVar();
            const lenGep = generator.llvmHelper.getNewTempVar();
            generator.emit(`${lenGep} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${stringPtr}, i32 0, i32 1`);
            generator.emit(`${lenVar} = load i64, i64* ${lenGep}, align 8`);
            return { value: lenVar, type: 'i64' };
        }
    },
    {
        name: '_builtin_create_string',
        handler: (generator, args) => {
            if (args.length !== 2) {
                throw new Error("_builtin_create_string requires exactly two arguments: ptr (i8*) and len (i64).");
            }
            const ptrArg = args[0];
            const lenArg = args[1];
            if (!ptrArg || ptrArg.type !== 'i8*' || !lenArg || lenArg.type !== 'i64') {
                throw new Error("_builtin_create_string arguments must be ptr (i8*) and len (i64).");
            }

            // Allocate string struct via malloc (24 bytes)
            generator.ensureHeapGlobals();
            const sizeBytes = '24';
            const raw = generator.llvmHelper.getNewTempVar();
            generator.emit(`${raw} = call i8* @yulang_malloc(i64 ${sizeBytes})`);
            const stringStructPtr = generator.llvmHelper.getNewTempVar();
            generator.emit(`${stringStructPtr} = bitcast i8* ${raw} to ${LangItems.string.structName}*`);

            // Store ptr
            const ptrGep = generator.llvmHelper.getNewTempVar();
            generator.emit(`${ptrGep} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${stringStructPtr}, i32 0, i32 0`);
            generator.emit(`store i8* ${ptrArg.value}, i8** ${ptrGep}, align 8`);

            // Store len
            const lenGep = generator.llvmHelper.getNewTempVar();
            generator.emit(`${lenGep} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${stringStructPtr}, i32 0, i32 1`);
            generator.emit(`store i64 ${lenArg.value}, i64* ${lenGep}, align 8`);

            // Store cap (same as len)
            const capGep = generator.llvmHelper.getNewTempVar();
            generator.emit(`${capGep} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${stringStructPtr}, i32 0, i32 2`);
            generator.emit(`store i64 ${lenArg.value}, i64* ${capGep}, align 8`);

            return { value: stringStructPtr, type: `${LangItems.string.structName}*` };
        }
    },
    {
        name: '_builtin_string_concat',
        handler: (generator, args) => {
            if (args.length !== 2) {
                throw new Error("_builtin_string_concat requires exactly two arguments: left (string) and right (string).");
            }
            const leftArg = args[0];
            const rightArg = args[1];
            if (!leftArg || leftArg.type !== `${LangItems.string.structName}*` || !rightArg || rightArg.type !== `${LangItems.string.structName}*`) {
                throw new Error("_builtin_string_concat arguments must be of type string.");
            }

            // Find the __string_add function (which is in std)
            const addFuncEntry = generator.getGlobalSymbol(`${LangItems.string_add.module}.${LangItems.string_add.symbolName}`);
            if (!addFuncEntry) {
                throw new Error(`String addition lang item '${LangItems.string_add.symbolName}' not found in standard library.`);
            }

            // Call __string_add, which handles SRET
            const tempResultPtr = generator.llvmHelper.getNewTempVar();
            generator.emit(`${tempResultPtr} = alloca ${LangItems.string.structName}, align 8`);
            generator.emit(`call void ${addFuncEntry.ptr}(ptr sret(${LangItems.string.structName}) align 8 ${tempResultPtr}, ${leftArg.type} ${leftArg.value}, ${rightArg.type} ${rightArg.value})`);
            
            return { value: tempResultPtr, type: `${LangItems.string.structName}*` };
        }
    },
    {
        name: 'alloca', // User-facing name (e.g., from std.yu)
        handler: (generator, args) => {
            if (args.length !== 1) {
                throw new Error("alloca requires exactly one argument: size (i32 or i64).");
            }
            const sizeArg = args[0];
            if (!sizeArg || (sizeArg.type !== 'i32' && sizeArg.type !== 'i64')) {
                throw new Error("alloca argument must be of type i32 or i64.");
            }

            let finalSizeValue = sizeArg.value;
            if (sizeArg.type === 'i64') {
                const truncatedSize = generator.llvmHelper.getNewTempVar();
                generator.emit(`${truncatedSize} = trunc i64 ${sizeArg.value} to i32`);
                finalSizeValue = truncatedSize;
            }
            
            const call = generator.builtins.createAlloca(finalSizeValue);
            generator.emit(call);
            const resultVar = call.split(' ')[0] as string;
            return { value: resultVar, type: 'i8*' };
        }
    }
];

const PREDEFINED_FUNCTIONS: PredefinedFunction[] = [
    ...BUILTIN_FUNCTIONS,
];

export function findPredefinedFunction(name: string): PredefinedFunction | undefined {
    return PREDEFINED_FUNCTIONS.find(f => f.name === name);
}

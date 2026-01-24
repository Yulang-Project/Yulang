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
        name: 'toString',
        handler: (generator, args) => {
            if (args.length !== 1) {
                throw new Error("toString() requires exactly one argument.");
            }
            const arg = args[0]!;
            let normalized = arg;
            if (arg.type === 'i32') {
                const widened = generator.llvmHelper.getNewTempVar();
                generator.emit(`${widened} = sext i32 ${arg.value} to i64`);
                normalized = { value: widened, type: 'i64' };
            } else if (arg.type === 'i1') {
                const widened = generator.llvmHelper.getNewTempVar();
                generator.emit(`${widened} = zext i1 ${arg.value} to i64`);
                normalized = { value: widened, type: 'i64' };
            } else if (arg.type.endsWith('*')) {
                const asInt = generator.llvmHelper.getNewTempVar();
                generator.emit(`${asInt} = ptrtoint ${arg.type} ${arg.value} to i64`);
                normalized = { value: asInt, type: 'i64' };
            } else if (arg.type !== 'i64') {
                throw new Error("toString() currently supports i32, i64, bool, and pointer values.");
            }

            const nVal = normalized.value;
            const h = generator.llvmHelper;

            const finalResultPtr = h.getNewTempVar(); // alloca %struct.string*
            generator.emit(`${finalResultPtr} = alloca ${LangItems.string.structName}*, align 8`);

            const isZeroLabel = generator.getNewLabel('tostr.iszero');
            const notZeroLabel = generator.getNewLabel('tostr.notzero');
            const finalExitLabel = generator.getNewLabel('tostr.exit');

            const isZeroCond = h.getNewTempVar();
            generator.emit(`${isZeroCond} = icmp eq i64 ${nVal}, 0`);
            generator.emit(`br i1 ${isZeroCond}, label %${isZeroLabel}, label %${notZeroLabel}`);

            // Zero Case
            generator.emit(`${isZeroLabel}:`, false);
            const zeroBuf = h.getNewTempVar();
            generator.emit(`${zeroBuf} = call i8* @yulang_malloc(i64 1)`);
            generator.emit(`store i8 48, i8* ${zeroBuf}, align 1`); // '0'
            const zeroStr = generator.builtins.createString(zeroBuf, "1");
            generator.emit(`store ${zeroStr.type} ${zeroStr.value}, ${zeroStr.type}* ${finalResultPtr}, align 8`);
            generator.emit(`br label %${finalExitLabel}`);

            // Non-Zero Case
            generator.emit(`${notZeroLabel}:`, false);
            const bufSize = 21;
            const buffer = h.getNewTempVar();
            generator.emit(`${buffer} = alloca i8, i64 ${bufSize}, align 1`);

            const endPtr = h.getNewTempVar();
            generator.emit(`${endPtr} = getelementptr i8, i8* ${buffer}, i64 ${bufSize}`);
            const ptr = h.getNewTempVar();
            generator.emit(`${ptr} = alloca i8*, align 8`);
            generator.emit(`store i8* ${endPtr}, i8** ${ptr}, align 8`);
            
            const isNeg = h.getNewTempVar();
            generator.emit(`${isNeg} = icmp slt i64 ${nVal}, 0`);
            const absVal = h.getNewTempVar();
            const negVal = h.getNewTempVar();
            generator.emit(`${negVal} = sub i64 0, ${nVal}`);
            generator.emit(`${absVal} = select i1 ${isNeg}, i64 ${negVal}, i64 ${nVal}`);
            const currentVal = h.getNewTempVar();
            generator.emit(`${currentVal} = alloca i64, align 8`);
            generator.emit(`store i64 ${absVal}, i64* ${currentVal}, align 8`);

            const loopHeader = generator.getNewLabel('tostr.loop.header');
            const loopBody = generator.getNewLabel('tostr.loop.body');
            const loopEnd = generator.getNewLabel('tostr.loop.end');
            generator.emit(`br label %${loopHeader}`);

            generator.emit(`${loopHeader}:`, false);
            const loopVar = h.getNewTempVar();
            generator.emit(`${loopVar} = load i64, i64* ${currentVal}, align 8`);
            const loopCond = h.getNewTempVar();
            generator.emit(`${loopCond} = icmp ne i64 ${loopVar}, 0`);
            generator.emit(`br i1 ${loopCond}, label %${loopBody}, label %${loopEnd}`);
            
            generator.emit(`${loopBody}:`, false);
            const loadedPtr1 = h.getNewTempVar();
            generator.emit(`${loadedPtr1} = load i8*, i8** ${ptr}, align 8`);
            const nextPtr = h.getNewTempVar();
            generator.emit(`${nextPtr} = getelementptr i8, i8* ${loadedPtr1}, i64 -1`);
            generator.emit(`store i8* ${nextPtr}, i8** ${ptr}, align 8`);
            
            const loadedVal = h.getNewTempVar();
            generator.emit(`${loadedVal} = load i64, i64* ${currentVal}, align 8`);
            const rem = h.getNewTempVar();
            generator.emit(`${rem} = srem i64 ${loadedVal}, 10`);
            const nextVal = h.getNewTempVar();
            generator.emit(`${nextVal} = sdiv i64 ${loadedVal}, 10`);
            generator.emit(`store i64 ${nextVal}, i64* ${currentVal}, align 8`);
            
            const digitChar = h.getNewTempVar();
            generator.emit(`${digitChar} = add i64 ${rem}, 48`);
            const digitI8 = h.getNewTempVar();
            generator.emit(`${digitI8} = trunc i64 ${digitChar} to i8`);
            generator.emit(`store i8 ${digitI8}, i8* ${nextPtr}, align 1`);
            generator.emit(`br label %${loopHeader}`);
            
            generator.emit(`${loopEnd}:`, false);

            const addSignLabel = generator.getNewLabel('tostr.addsign');
            const signEndLabel = generator.getNewLabel('tostr.sign.end');
            generator.emit(`br i1 ${isNeg}, label %${addSignLabel}, label %${signEndLabel}`);

            generator.emit(`${addSignLabel}:`, false);
            const loadedPtr2 = h.getNewTempVar();
            generator.emit(`${loadedPtr2} = load i8*, i8** ${ptr}, align 8`);
            const nextPtr2 = h.getNewTempVar();
            generator.emit(`${nextPtr2} = getelementptr i8, i8* ${loadedPtr2}, i64 -1`);
            generator.emit(`store i8* ${nextPtr2}, i8** ${ptr}, align 8`);
            generator.emit(`store i8 45, i8* ${nextPtr2}, align 1`); // '-'
            generator.emit(`br label %${signEndLabel}`);

            generator.emit(`${signEndLabel}:`, false);

            const finalStrStartPtr = h.getNewTempVar();
            generator.emit(`${finalStrStartPtr} = load i8*, i8** ${ptr}, align 8`);
            const finalLen = h.getNewTempVar();
            const endPtrInt = h.getNewTempVar();
            const startPtrInt = h.getNewTempVar();
            generator.emit(`${endPtrInt} = ptrtoint i8* ${endPtr} to i64`);
            generator.emit(`${startPtrInt} = ptrtoint i8* ${finalStrStartPtr} to i64`);
            generator.emit(`${finalLen} = sub i64 ${endPtrInt}, ${startPtrInt}`);

            const heapBuf = h.getNewTempVar();
            generator.emit(`${heapBuf} = call i8* @yulang_malloc(i64 ${finalLen})`);
            generator.emit(`call void @__memcpy_inline(i8* ${heapBuf}, i8* ${finalStrStartPtr}, i64 ${finalLen})`);
            
            const finalString = generator.builtins.createString(heapBuf, finalLen);
            generator.emit(`store ${finalString.type} ${finalString.value}, ${finalString.type}* ${finalResultPtr}, align 8`);
            generator.emit(`br label %${finalExitLabel}`);

            // Final Exit
            generator.emit(`${finalExitLabel}:`, false);
            const finalValue = h.getNewTempVar();
            generator.emit(`${finalValue} = load ${LangItems.string.structName}*, ${LangItems.string.structName}** ${finalResultPtr}, align 8`);

            return { value: finalValue, type: `${LangItems.string.structName}*` };
        }
    },
    {
        name: 'toInt',
        handler: (generator, args) => {
            if (args.length !== 1) {
                throw new Error("toInt() requires exactly one argument.");
            }
            const strArg = generator.ensureStringPointer(args[0]!);
            if (!strArg) {
                throw new Error("toInt() expects a string argument.");
            }
            const h = generator.llvmHelper;

            const dataPtrPtr = h.getNewTempVar();
            generator.emit(`${dataPtrPtr} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${strArg.value}, i32 0, i32 ${LangItems.string.members.ptr.index}`);
            const dataPtr = h.getNewTempVar();
            generator.emit(`${dataPtr} = load i8*, i8** ${dataPtrPtr}, align 8`);

            const lenPtr = h.getNewTempVar();
            generator.emit(`${lenPtr} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${strArg.value}, i32 0, i32 ${LangItems.string.members.len.index}`);
            const lenVal = h.getNewTempVar();
            generator.emit(`${lenVal} = load i64, i64* ${lenPtr}, align 8`);

            const resultPtr = h.getNewTempVar();
            generator.emit(`${resultPtr} = alloca i64, align 8`);
            generator.emit(`store i64 0, i64* ${resultPtr}, align 8`);

            const negativePtr = h.getNewTempVar();
            generator.emit(`${negativePtr} = alloca i1, align 1`);
            generator.emit(`store i1 false, i1* ${negativePtr}, align 1`);

            const indexPtr = h.getNewTempVar();
            generator.emit(`${indexPtr} = alloca i64, align 8`);
            generator.emit(`store i64 0, i64* ${indexPtr}, align 8`);

            const hasChars = h.getNewTempVar();
            const checkFirst = generator.getNewLabel('toint.check_first');
            const parseLoop = generator.getNewLabel('toint.loop');
            generator.emit(`${hasChars} = icmp ne i64 ${lenVal}, 0`);
            generator.emit(`br i1 ${hasChars}, label %${checkFirst}, label %${parseLoop}`);

            // Optional sign handling
            generator.emit(`${checkFirst}:`, false);
            const firstCharPtr = h.getNewTempVar();
            generator.emit(`${firstCharPtr} = getelementptr inbounds i8, i8* ${dataPtr}, i64 0`);
            const firstChar = h.getNewTempVar();
            generator.emit(`${firstChar} = load i8, i8* ${firstCharPtr}, align 1`);
            const isMinus = h.getNewTempVar();
            generator.emit(`${isMinus} = icmp eq i8 ${firstChar}, 45`);
            const skipSign = generator.getNewLabel('toint.skip_sign');
            const afterSign = generator.getNewLabel('toint.after_sign');
            generator.emit(`br i1 ${isMinus}, label %${skipSign}, label %${afterSign}`);

            generator.emit(`${skipSign}:`, false);
            generator.emit(`store i64 1, i64* ${indexPtr}, align 8`);
            generator.emit(`store i1 true, i1* ${negativePtr}, align 1`);
            generator.emit(`br label %${afterSign}`);

            generator.emit(`${afterSign}:`, false);
            generator.emit(`br label %${parseLoop}`);

            // Loop
            const loopBody = generator.getNewLabel('toint.loop.body');
            const loopEnd = generator.getNewLabel('toint.loop.end');
            generator.emit(`${parseLoop}:`, false);
            const currentIdx = h.getNewTempVar();
            generator.emit(`${currentIdx} = load i64, i64* ${indexPtr}, align 8`);
            const cond = h.getNewTempVar();
            generator.emit(`${cond} = icmp ult i64 ${currentIdx}, ${lenVal}`);
            generator.emit(`br i1 ${cond}, label %${loopBody}, label %${loopEnd}`);

            generator.emit(`${loopBody}:`, false);
            const charPtr = h.getNewTempVar();
            generator.emit(`${charPtr} = getelementptr inbounds i8, i8* ${dataPtr}, i64 ${currentIdx}`);
            const rawChar = h.getNewTempVar();
            generator.emit(`${rawChar} = load i8, i8* ${charPtr}, align 1`);
            const charAsInt = h.getNewTempVar();
            generator.emit(`${charAsInt} = sext i8 ${rawChar} to i64`);
            const digitVal = h.getNewTempVar();
            generator.emit(`${digitVal} = sub i64 ${charAsInt}, 48`);

            const currentVal = h.getNewTempVar();
            generator.emit(`${currentVal} = load i64, i64* ${resultPtr}, align 8`);
            const mulTen = h.getNewTempVar();
            generator.emit(`${mulTen} = mul i64 ${currentVal}, 10`);
            const nextVal = h.getNewTempVar();
            generator.emit(`${nextVal} = add i64 ${mulTen}, ${digitVal}`);
            generator.emit(`store i64 ${nextVal}, i64* ${resultPtr}, align 8`);

            const nextIdx = h.getNewTempVar();
            generator.emit(`${nextIdx} = add i64 ${currentIdx}, 1`);
            generator.emit(`store i64 ${nextIdx}, i64* ${indexPtr}, align 8`);
            generator.emit(`br label %${parseLoop}`);

            generator.emit(`${loopEnd}:`, false);
            const rawResult = h.getNewTempVar();
            generator.emit(`${rawResult} = load i64, i64* ${resultPtr}, align 8`);
            const isNeg = h.getNewTempVar();
            generator.emit(`${isNeg} = load i1, i1* ${negativePtr}, align 1`);
            const negVal = h.getNewTempVar();
            generator.emit(`${negVal} = sub i64 0, ${rawResult}`);
            const finalVal = h.getNewTempVar();
            generator.emit(`${finalVal} = select i1 ${isNeg}, i64 ${negVal}, i64 ${rawResult}`);

            return { value: finalVal, type: 'i64' };
        }
    },
    {
        name: '_builtin_string_to_ptr',
        handler: (generator, args) => {
            if (args.length !== 1) {
                throw new Error("_builtin_string_to_ptr requires exactly one argument: string.");
            }
            const stringArg = generator.ensureStringPointer(args[0]!);
            if (!stringArg) {
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
            const stringArg = generator.ensureStringPointer(args[0]!);
            if (!stringArg) {
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

            // Allocate string struct via malloc (16 bytes)
            generator.ensureHeapGlobals();
            const sizeBytes = '16';
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

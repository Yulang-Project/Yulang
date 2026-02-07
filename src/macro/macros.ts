// src/macro/macros.ts

import { IRGenerator, type IRValue } from '../generator/ir_generator.js';
import * as irgen_utils from '../generator/irgen/ir_generator_utils.js';
import { LangItems } from '../generator/lang_items.js';
import { TokenType } from '../token.js'; // NEW
import { findPredefinedFunction } from '../predefine/funs.js'; // NEW
import { type PredefinedFunction } from '../predefine/types.js'; // Re-use PredefinedFunction type

// 定义宏块内部可用的特殊函数
export const MACRO_BLOCK_FUNCTIONS: PredefinedFunction[] = [
    // 示例：ptr_add (模拟 C 的指针算术)
    {
        name: 'ptr_add',
        handler: (generator, args) => {
            if (args.length !== 2) {
                throw new Error("ptr_add requires exactly two arguments: ptr (pointer) and offset (i64).");
            }
            const ptrArg = args[0];
            const offsetArg = args[1];

            if (!ptrArg || !ptrArg.type.endsWith('*')) {
                throw new Error("ptr_add first argument must be a pointer type.");
            }
            if (!offsetArg || offsetArg.type !== 'i64') {
                throw new Error("ptr_add second argument must be of type i64.");
            }

            const baseType = ptrArg.type.slice(0, -1); // Remove '*' to get base type
            const newPtr = generator.llvmHelper.getNewTempVar();
            // getelementptr 指令用于指针算术
            generator.emit(`${newPtr} = getelementptr ${baseType}, ${ptrArg.type} ${ptrArg.value}, i64 ${offsetArg.value}`);
            
            return { value: newPtr, type: ptrArg.type };
        }
    },
    // 示例：mem_read (模拟 C 的解引用)
    {
        name: 'mem_read',
        handler: (generator, args) => {
            if (args.length !== 1) {
                throw new Error("mem_read requires exactly one argument: ptr (pointer).");
            }
            const ptrArg = args[0];

            if (!ptrArg || !ptrArg.type.endsWith('*')) {
                throw new Error("mem_read argument must be a pointer type.");
            }

            const baseType = ptrArg.type.slice(0, -1);
            const loadedValue = generator.llvmHelper.getNewTempVar();
            generator.emit(`${loadedValue} = load ${baseType}, ${ptrArg.type} ${ptrArg.value}, align ${generator.llvmHelper.getAlign(baseType)}`);

            return { value: loadedValue, type: baseType };
        }
    },
    // 示例：mem_write (模拟 C 的赋值到指针)
    {
        name: 'mem_write',
        handler: (generator, args) => {
            if (args.length !== 2) {
                throw new Error("mem_write requires exactly two arguments: ptr (pointer) and value.");
            }
            const ptrArg = args[0];
            const valueArg = args[1];

            if (!ptrArg || !ptrArg.type.endsWith('*')) {
                throw new Error("mem_write first argument must be a pointer type.");
            }
            if (!valueArg) {
                throw new Error("mem_write second argument must be a value.");
            }

            const baseType = ptrArg.type.slice(0, -1);
            const coercedValue = irgen_utils.coerceValue(generator, valueArg, baseType); // 确保类型匹配

            generator.emit(`store ${baseType} ${coercedValue.value}, ${ptrArg.type} ${ptrArg.value}, align ${generator.llvmHelper.getAlign(baseType)}`);

            return { value: '', type: 'void' };
        }
    },
    // 示例：ptr_to_int (指针转整数)
    {
        name: 'ptr_to_int',
        handler: (generator, args) => {
            if (args.length !== 1) {
                throw new Error("ptr_to_int requires exactly one argument: ptr (pointer).");
            }
            const ptrArg = args[0];

            if (!ptrArg || !ptrArg.type.endsWith('*')) {
                throw new Error("ptr_to_int argument must be a pointer type.");
            }
            const intValue = generator.llvmHelper.getNewTempVar();
            const ptrSize = generator.platform.getPointerSizeInBits();
            generator.emit(`${intValue} = ptrtoint ${ptrArg.type} ${ptrArg.value} to i${ptrSize}`);
            return { value: intValue, type: `i${ptrSize}` };
        }
    },
    // 示例：int_to_ptr (整数转指针)
    {
        name: 'int_to_ptr',
        handler: (generator, args) => {
            if (args.length !== 2) {
                throw new Error("int_to_ptr requires exactly two arguments: int_value (i64) and target_ptr_type (string literal, e.g., \"i8*\").");
            }
            const intArg = args[0];
            const typeArg = args[1]!; // Expected to be a string literal token

            if (!intArg || !intArg.type.startsWith('i')) {
                throw new Error("int_to_ptr first argument must be an integer type.");
            }
            if (typeArg.type !== TokenType.STRING_LITERAL) { // Check if it's a string literal token
                throw new Error("int_to_ptr second argument must be a string literal representing a pointer type (e.g., \"i8*\").");
            }
            const targetType = typeArg.value; // String literal's value is in .value for IRValue
            if (!targetType.endsWith('*')) {
                throw new Error("int_to_ptr target_ptr_type must be a pointer type (e.g., \"i8*\").");
            }

            const ptrValue = generator.llvmHelper.getNewTempVar();
            generator.emit(`${ptrValue} = inttoptr ${intArg.type} ${intArg.value} to ${targetType}`);
            return { value: ptrValue, type: targetType };
        }
    },
    // cstr_strlen: 计算 C 风格字符串长度
    {
        name: 'cstr_strlen',
        handler: (generator, args) => {
            if (args.length !== 1) {
                throw new Error("cstr_strlen requires exactly one argument: ptr (i8*).");
            }
            const ptrArg = args[0];

            if (!ptrArg || ptrArg.type !== 'i8*') {
                throw new Error("cstr_strlen argument must be of type i8*.");
            }
            
            const h = generator.llvmHelper;
            const currentPtrAlloca = h.getNewTempVar();
            generator.emit(`${currentPtrAlloca} = alloca i8*, align 8`);
            generator.emit(`store i8* ${ptrArg.value}, i8** ${currentPtrAlloca}, align 8`);

            const lengthAlloca = h.getNewTempVar();
            generator.emit(`${lengthAlloca} = alloca i64, align 8`);
            generator.emit(`store i64 0, i64* ${lengthAlloca}, align 8`);

            const loopHeader = generator.getNewLabel('cstr_strlen.loop');
            const loopExit = generator.getNewLabel('cstr_strlen.exit');
            generator.emit(`br label %${loopHeader}`);

            generator.emit(`${loopHeader}:`, false);
            const currentPtr = h.getNewTempVar();
            generator.emit(`${currentPtr} = load i8*, i8** ${currentPtrAlloca}, align 8`);
            const currentChar = h.getNewTempVar();
            generator.emit(`${currentChar} = load i8, i8* ${currentPtr}, align 1`);
            const isNull = h.getNewTempVar();
            generator.emit(`${isNull} = icmp eq i8 ${currentChar}, 0`);
            generator.emit(`br i1 ${isNull}, label %${loopExit}, label %${generator.getNewLabel('cstr_strlen.body')}`);

            generator.emit(`${generator.getNewLabel('cstr_strlen.body')}:`, false);
            const currentLength = h.getNewTempVar();
            generator.emit(`${currentLength} = load i64, i64* ${lengthAlloca}, align 8`);
            const nextLength = h.getNewTempVar();
            generator.emit(`${nextLength} = add i64 ${currentLength}, 1`);
            generator.emit(`store i64 ${nextLength}, i64* ${lengthAlloca}, align 8`);

            const nextPtr = h.getNewTempVar();
            generator.emit(`${nextPtr} = getelementptr i8, i8* ${currentPtr}, i64 1`);
            generator.emit(`store i8* ${nextPtr}, i8** ${currentPtrAlloca}, align 8`);
            generator.emit(`br label %${loopHeader}`);

            generator.emit(`${loopExit}:`, false);
            const finalLength = h.getNewTempVar();
            generator.emit(`${finalLength} = load i64, i64* ${lengthAlloca}, align 8`);
            return { value: finalLength, type: 'i64' };
        }
    },
    // cstr_to_string: 将 C 风格字符串转换为 Yulang 字符串
    {
        name: 'cstr_to_string',
        handler: (generator, args) => {
            if (args.length !== 1) {
                throw new Error("cstr_to_string requires exactly one argument: ptr (i8*).");
            }
            const ptrArg = args[0];

            if (!ptrArg || ptrArg.type !== 'i8*') {
                throw new Error("cstr_to_string argument must be of type i8*.");
            }

            const strlenResult = MACRO_BLOCK_FUNCTIONS.find(f => f.name === 'cstr_strlen')?.handler(generator, [ptrArg]) as IRValue;
            if (!strlenResult) {
                throw new Error("Internal error: cstr_strlen not found in MACRO_BLOCK_FUNCTIONS.");
            }

            // Call _builtin_create_string
            const createStringBuiltin = findPredefinedFunction('_builtin_create_string');
            if (!createStringBuiltin) {
                throw new Error("Internal error: _builtin_create_string not found.");
            }

            // _builtin_create_string expects ptr (i8*) and len (i64)
            return createStringBuiltin.handler(generator, [ptrArg, strlenResult]);
        }
    },
];

// Helper to find a function within the macro block context
export function findMacroBlockFunction(name: string): PredefinedFunction | undefined {
    return MACRO_BLOCK_FUNCTIONS.find(f => f.name === name);
}

// src/generator/irgen/expr_functions.ts

import {
    IdentifierExpr, CallExpr, FunctionLiteralExpr, FunctionDeclaration
} from '../../ast.js';
import { Token, TokenType } from '../../token.js';
import { LangItems } from '../lang_items.js';
import { findPredefinedFunction } from '../../predefine/funs.js';
import { MACRO_BLOCK_FUNCTIONS, findMacroBlockFunction } from '../../macro/macros.js';
import { ClosureAnalyzer } from './types_scopes.js';
import { IRGenerator } from './ir_generator_base.js';
import type { IRValue } from './types_scopes.js';

/**
 * 处理 Call 表达式。
 * @param generator IR 生成器实例。
 * @param expr CallExpr 表达式。
 * @returns 表达式的 IRValue。
 */
export function visitCallExpr(generator: IRGenerator, expr: CallExpr): IRValue {
    // 特殊情况：`addrof` 用于直接获取变量地址。
    if (expr.callee instanceof IdentifierExpr && expr.callee.name.lexeme === 'addrof') {
        if (expr.args.length !== 1 || !(expr.args[0] instanceof IdentifierExpr)) {
            throw new Error("addrof() 需要一个且只能是一个变量名参数。");
        }
        const varName = (expr.args[0] as IdentifierExpr).name.lexeme;
        const entry = generator.currentScope.find(varName);
        if (!entry) {
            throw new Error(`未定义变量: ${varName}`);
        }

        const resultVar = generator.llvmHelper.getNewTempVar();
        generator.emit(`${resultVar} = ptrtoint ${entry.llvmType}* ${entry.ptr} to i64`);
        return { value: resultVar, type: 'i64' };
    }

    // 直接处理预定义/内置函数
    if (expr.callee instanceof IdentifierExpr) {
        const calleeName = expr.callee.name.lexeme;

        // 如果在宏块内，首先检查宏块函数
        if (generator.inMacroBlock && generator.macroBlockType === TokenType.UNSAFE) {
            const macroFunc = findMacroBlockFunction(calleeName);
            if (macroFunc) {
                const evaluatedArgs = expr.args.map(a => a.accept(generator) as IRValue);
                return macroFunc.handler(generator, evaluatedArgs);
            }
        }

        const predefined = findPredefinedFunction(calleeName);
        if (predefined) {
            const evaluatedArgs = expr.args.map(a => a.accept(generator) as IRValue);
            return predefined.handler(generator, evaluatedArgs);
        }
    }

    let calleeInfo = expr.callee.accept(generator) as IRValue;
    const argValues = expr.args.map(arg => arg.accept(generator) as IRValue);

    // --- 闭包调用处理 ---
    // 如果被调用者是一个闭包对象 (即 { func*, env* }* 类型),
    // 我们需要解构它以获取真正的函数指针和环境指针。
    if (calleeInfo.type.startsWith('{') && calleeInfo.type.endsWith('}*')) {
        const closureObjPtr = calleeInfo.value;
        const closureObjType = calleeInfo.type.slice(0, -1);
        if (generator.debug) console.log(`Unwrap closure: objPtr=${closureObjPtr}, objType=${closureObjType}`);

        // 1. 从闭包对象中加载函数指针 (位于字段 0)
        const funcPtrFieldPtr = generator.llvmHelper.getNewTempVar();
        generator.emit(`${funcPtrFieldPtr} = getelementptr inbounds ${closureObjType}, ${calleeInfo.type} ${closureObjPtr}, i32 0, i32 0`);

        // 从结构体类型字符串中提取函数指针和环境指针类型
        const fields = generator.splitStructFields(closureObjType);
        if (fields.length < 2) {
            throw new Error(`无法从闭包对象类型中提取字段类型: ${closureObjType}`);
        }
        const loadedFuncPtrType = fields[0]!; // 已经以 '*' 结尾
        const loadedFuncPtr = generator.llvmHelper.getNewTempVar();
        generator.emit(`${loadedFuncPtr} = load ${loadedFuncPtrType}, ${loadedFuncPtrType}* ${funcPtrFieldPtr}, align 8`);

        // 2. 从闭包对象中加载环境指针 (位于字段 1)
        const envPtrFieldPtr = generator.llvmHelper.getNewTempVar();
        generator.emit(`${envPtrFieldPtr} = getelementptr inbounds ${closureObjType}, ${calleeInfo.type} ${closureObjPtr}, i32 0, i32 1`);

        const loadedEnvPtrType = fields[1]!;
        const loadedEnvPtr = generator.llvmHelper.getNewTempVar();
        generator.emit(`${loadedEnvPtr} = load ${loadedEnvPtrType}, ${loadedEnvPtrType}* ${envPtrFieldPtr}, align 8`);

        // 3. 更新 calleeInfo 并将环境指针作为第一个参数
        calleeInfo = { value: loadedFuncPtr, type: loadedFuncPtrType };
        argValues.unshift({ value: loadedEnvPtr, type: loadedEnvPtrType });
    }
    // --- 结束闭包调用处理 ---

    const funcRef = calleeInfo.value; // 可调用引用 (函数符号或指针)

    // 特殊情况 syscall 内建函数
    if (calleeInfo.type === 'internal_syscall' || calleeInfo.value === '__syscall6') {
        const syscallNum = argValues[0];
        if (!syscallNum) {
            throw new Error("syscall 内建函数至少需要一个 syscall 编号参数。");
        }
        const argsForPlatform = argValues.slice(1);
        return generator.platform.emitSyscall(generator, syscallNum, argsForPlatform);
    }

    // 如果由 GetExpr 提供，注入隐式 'this' 用于方法调用
    if (calleeInfo.classInstancePtr) {
        argValues.unshift({
            value: calleeInfo.classInstancePtr,
            type: calleeInfo.classInstancePtrType || 'i8*'
        });
    }

    if (generator.debug) console.log(`Call candidate: callee=${calleeInfo.value}, type=${calleeInfo.type}`);
    const typeStr = calleeInfo.type.trim();
    if (!typeStr.endsWith('*')) {
        console.error(`调用目标不是函数指针: callee=${calleeInfo.value}, type=${calleeInfo.type}`);
        throw new Error(`尝试调用非函数类型: ${calleeInfo.type} (callee: ${calleeInfo.value})`);
    }

    // 解析函数类型字符串，例如 "ret (param1, param2)*"，即使参数是函数指针。
    const withoutStar = typeStr.slice(0, -1).trim(); // 移除尾随的 '*'
    const lastParen = withoutStar.lastIndexOf(')');
    let paramListStart = -1;
    let scanDepth = 0;
    for (let i = lastParen; i >= 0; i--) {
        const ch = withoutStar[i];
        if (ch === ')') scanDepth++;
        else if (ch === '(') {
            scanDepth--;
            if (scanDepth === 0) {
                paramListStart = i;
                break;
            }
        }
    }

    if (paramListStart < 0 || lastParen < paramListStart) {
        throw new Error(`尝试调用非函数类型: ${calleeInfo.type} (callee: ${calleeInfo.value})`);
    }
    const returnType = withoutStar.slice(0, paramListStart).trim();
    const paramTypesRaw = withoutStar.slice(paramListStart + 1, lastParen);

    // 拆分参数，同时尊重函数指针参数中的嵌套括号。
    const paramTypes: string[] = [];
    let current = '';
    let depth = 0;
    for (const ch of paramTypesRaw) {
        if (ch === ',' && depth === 0) {
            if (current.trim().length > 0) paramTypes.push(current.trim());
            current = '';
            continue;
        }
        if (ch === '(' || ch === '{' || ch === '[') depth++;
        if (ch === ')' || ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
        current += ch;
    }
    if (current.trim().length > 0) paramTypes.push(current.trim());

    if (generator.debug) console.log(`Call: callee=${calleeInfo.value}, type=${calleeInfo.type}, ret=${returnType}, params=[${paramTypes.join(', ')}]`);

    let callArgs: string[] = [];

    // 处理 SRET 风格函数 (无返回类型，第一个参数为结构体指针)
    let sretPtrVar: string | null = null;
    let sretParamType: string | null = null;
    let effectiveParamTypes = paramTypes;
    const firstParam = paramTypes[0];
    const isSretFunc = (returnType === 'void' && firstParam && firstParam.startsWith('%struct.') && firstParam.endsWith('*'));
    if (isSretFunc) {
        sretParamType = firstParam;
        const structType = firstParam.slice(0, -1);
        sretPtrVar = generator.llvmHelper.getNewTempVar();
        generator.emit(`${sretPtrVar} = alloca ${structType}, align ${generator.llvmHelper.getAlign(structType)}`);
        callArgs.push(`${firstParam} ${sretPtrVar}`);
        effectiveParamTypes = paramTypes.slice(1);
    }

    argValues.forEach((arg, idx) => {
        const expectedParam = effectiveParamTypes[idx]; // 此参数的预期 LLVM 类型
        let argValue = arg.value;
        let argType = arg.type;

        // 如果预期字符串值但我们有非字符串标量，则使用内置 toString() 自动转换。
        if (expectedParam === LangItems.string.structName && argType !== LangItems.string.structName && argType !== `${LangItems.string.structName}*`) {
            const toStringBuiltin = findPredefinedFunction('toString');
            if (toStringBuiltin) {
                const converted = toStringBuiltin.handler(generator, [arg]) as IRValue;
                argValue = converted.value;
                argType = converted.type;
            }
        }

        // 如果参数数量不匹配，或者没有期望的参数类型，我们跳过隐式引用，但仍会尝试类型转换
        if (!expectedParam) {
            callArgs.push(`${argType} ${argValue}`); // 如果没有期望类型，则在转换后按原样传递
            return;
        }

        // 结构体指针 -> 结构体值，当被调用者期望一个值时。
        if (expectedParam.startsWith('%struct.') && !expectedParam.endsWith('*') && argType === `${expectedParam}*`) {
            const loadedStruct = generator.llvmHelper.getNewTempVar();
            generator.emit(`${loadedStruct} = load ${expectedParam}, ${expectedParam}* ${argValue}, align ${generator.llvmHelper.getAlign(expectedParam)}`);
            argValue = loadedStruct;
            argType = expectedParam;
        }

        // --- 参数传递语义和隐式引用 ---
        // 规则1: 如果函数期望 T*，而传入的是 T，则自动获取地址。
        if (expectedParam.endsWith('*') && !argType.endsWith('*')) {
            const expectedBaseType = expectedParam.slice(0, -1); // 期望的基础类型
            // 检查基础类型是否匹配 (例如，期望 i32*，传入 i32)
            if (expectedBaseType === argType) {
                if (!arg.address) {
                    // 如果参数是字面量或表达式结果，没有直接地址，
                    // 则在栈上分配临时空间存储值，然后传递该临时空间的地址。
                    const tempAlloca = generator.llvmHelper.getNewTempVar();
                    generator.emit(`${tempAlloca} = alloca ${argType}, align ${generator.llvmHelper.getAlign(argType)}`);
                    generator.emit(`store ${argType} ${argValue}, ${argType}* ${tempAlloca}, align ${generator.llvmHelper.getAlign(argType)}`);
                    argValue = tempAlloca; // 现在 argValue 是临时 alloca 的指针
                } else {
                    // 如果参数有直接地址 (例如，它本身就是个变量)，则使用其地址。
                    argValue = arg.address;
                }
                argType = expectedParam; // 现在参数类型是期望的指针类型
            }
        }
        // --- 结束参数传递语义和隐式引用 ---


        // --- 类型转换 (T to expectedParam) ---
        if (expectedParam !== argType) {
            // 结构体指针 -> 结构体值 (加载)
            if (expectedParam.startsWith('%struct.') && !expectedParam.endsWith('*') && argType === `${expectedParam}*`) {
                const loadedStruct = generator.llvmHelper.getNewTempVar();
                generator.emit(`${loadedStruct} = load ${expectedParam}, ${expectedParam}* ${argValue}, align ${generator.llvmHelper.getAlign(expectedParam)}`);
                argValue = loadedStruct;
                argType = expectedParam;
            } else {
                const convertedArg = generator.llvmHelper.getNewTempVar();
                const currentArgType = argType;
                const currentArgValue = argValue;

                const isCurrentInt = currentArgType.startsWith('i');
                const isExpectedInt = expectedParam.startsWith('i');
                const isCurrentFloat = currentArgType.startsWith('f');
                const isExpectedFloat = expectedParam.startsWith('f');
                const isCurrentPtr = currentArgType.endsWith('*');
                const isExpectedPtr = expectedParam.endsWith('*');

                if (isCurrentInt && isExpectedInt) {
                    const currentBits = parseInt(currentArgType.slice(1), 10);
                    const expectedBits = parseInt(expectedParam.slice(1), 10);
                    if (expectedBits > currentBits) {
                        generator.emit(`${convertedArg} = sext ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    } else if (expectedBits < currentBits) {
                        generator.emit(`${convertedArg} = trunc ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    } else { // 相同的位宽，但可能处理不同的符号 (尽管 LLVM 对 bitcast 的 iN 类型处理统一)
                        generator.emit(`${convertedArg} = bitcast ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    }
                    argValue = convertedArg;
                    argType = expectedParam;
                } else if (isCurrentFloat && isExpectedFloat) {
                    const currentBits = parseInt(currentArgType.slice(1), 10);
                    const expectedBits = parseInt(expectedParam.slice(1), 10);
                    if (expectedBits > currentBits) { // 例如，f32 到 f64
                        generator.emit(`${convertedArg} = fpext ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    } else if (expectedBits < currentBits) { // 例如，f64 到 f32
                        generator.emit(`${convertedArg} = fptrunc ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    }
                    argValue = convertedArg;
                    argType = expectedParam;
                } else if (isCurrentInt && isExpectedFloat) { // int to float
                    generator.emit(`${convertedArg} = sitofp ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    argValue = convertedArg;
                    argType = expectedParam;
                } else if (isCurrentFloat && isExpectedInt) { // float to int
                    generator.emit(`${convertedArg} = fptosi ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    argValue = convertedArg;
                    argType = expectedParam;
                } else if (isCurrentPtr && isExpectedPtr) { // 指针到指针 bitcast
                    generator.emit(`${convertedArg} = bitcast ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    argValue = convertedArg;
                    argType = expectedParam;
                } else if (isCurrentInt && isExpectedPtr) { // int to pointer
                    generator.emit(`${convertedArg} = inttoptr ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    argValue = convertedArg;
                    argType = expectedParam;
                } else if (isCurrentPtr && isExpectedInt) { // pointer to int
                    generator.emit(`${convertedArg} = ptrtoint ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    argValue = convertedArg;
                    argType = expectedParam;
                } else if (currentArgType.startsWith('%struct.') && expectedParam.startsWith('%struct.')) {
                    // 结构体到结构体转换 (例如从字符串字面量常量到局部字符串结构体)
                    // 如果当前参数是结构体指针，而预期是结构体值，我们需要加载。
                    // 这种情况主要由隐式引用处理。
                    // 如果是直接结构体值到结构体值，可能需要 bitcast (如果类型只是名义上的)。
                    // 目前，假定隐式引用处理常见情况。
                    // 如果 currentArgType 是 %struct.foo* 且 expectedParam 是 %struct.bar，则意味着加载然后 bitcast 值或错误。
                    // 目前，如果类型是字面上不同的结构体类型，除非定义了特定的转换，否则抛出错误。
                    // 或者如果大小兼容，则隐式 bitcast。目前，我们将依赖于严格的类型匹配，除非显式强制转换。
                } else {
                    // 未处理转换的备用方案
                    // throw new Error(`无法转换类型从 ${currentArgType} 到 ${expectedParam}。`);
                    // 为了健壮性，允许 bitcast 作为最后的手段，假设 LLVM 会验证。
                    if (currentArgType !== expectedParam) { // 仅当真正不同时
                        generator.emit(`${convertedArg} = bitcast ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                        argValue = convertedArg;
                        argType = expectedParam;
                    }
                }
            }
        }
        // --- 结束类型转换 ---
        callArgs.push(`${argType} ${argValue}`);
    });

    const callInstr = `call ${returnType} ${funcRef}(${callArgs.join(', ')})`;

    if (returnType === 'void') {
        generator.emit(callInstr);
        if (sretPtrVar && sretParamType) {
            return { value: sretPtrVar, type: `${sretParamType}` };
        }
        return { value: '', type: 'void' };
    }

    const resultVar = generator.llvmHelper.getNewTempVar();
    generator.emit(`${resultVar} = ${callInstr}`);
    return { value: resultVar, type: returnType };
}

// src/generator/irgen/expr_variables.ts

import {
    IdentifierExpr, GetExpr, AssignExpr, AddressOfExpr, DereferenceExpr
} from '../../ast.js';
import { LangItems } from '../lang_items.js';
import { CapturedVariableInfo } from './types_scopes.js'; // Corrected import
import { IRGenerator } from './ir_generator_base.js';
import * as irgen_utils from './ir_generator_utils.js';
import type { IRValue } from './types_scopes.js';

/**
 * 处理 AddressOf 表达式。
 * @param generator IR 生成器实例。
 * @param expr AddressOfExpr 表达式。
 * @returns 表达式的 IRValue。
 */
export function visitAddressOfExpr(generator: IRGenerator, expr: AddressOfExpr): IRValue {
    // 评估内部表达式以获取其存储位置
    // 这通常适用于局部变量 (alloca'd) 或全局变量
    if (expr.expression instanceof IdentifierExpr) {
        const varName = expr.expression.name.lexeme;
        const entry = generator.currentScope.find(varName);
        if (!entry) {
            throw new Error(`无法获取未声明变量 '${varName}' 的地址。`);
        }
        const ptrType = `${entry.llvmType}*`;
        const asInt = generator.llvmHelper.getNewTempVar();
        generator.emit(`${asInt} = ptrtoint ${ptrType} ${entry.ptr} to i64`);
        return { value: asInt, type: 'i64', ptr: entry.ptr, ptrType };
    } else if (expr.expression instanceof GetExpr) {
        // 获取属性的地址，例如 &obj.prop
        const objectInfo = generator.visitGetExpr(expr.expression);
        const memberName = expr.expression.name.lexeme;

        const isPointer = objectInfo.type.endsWith('*');
        const baseType = isPointer ? objectInfo.type.slice(0, -1) : objectInfo.type;

        if (!baseType.startsWith('%struct.')) {
            throw new Error(`无法获取非结构体类型属性 '${memberName}' 的地址: ${objectInfo.type}`);
        }

        const className = baseType.substring('%struct.'.length);
        const classEntry = generator.classDefinitions.get(className);
        if (!classEntry) {
            throw new Error(`未定义类型 '${className}' 的类定义。`);
        }

        const memberEntry = classEntry.members.get(memberName);
        if (!memberEntry) {
            throw new Error(`类 '${className}' 中未定义成员 '${memberName}'。`);
        }

        const memberPtrVar = generator.llvmHelper.getNewTempVar();
        if (isPointer) { // 对象本身是一个指针 (例如，类实例)
            generator.emit(`${memberPtrVar} = getelementptr inbounds ${classEntry.llvmType}, ${objectInfo.type} ${objectInfo.value}, i32 0, i32 ${memberEntry.index}`);
        } else { // 对象是一个结构体值 (按值传递)
            throw new Error(`尚不支持获取值类型结构体属性 '${memberName}' 的地址。`);
        }
        const asInt = generator.llvmHelper.getNewTempVar();
        generator.emit(`${asInt} = ptrtoint ${memberEntry.llvmType}* ${memberPtrVar} to i64`);
        return { value: asInt, type: 'i64', ptr: memberPtrVar, ptrType: `${memberEntry.llvmType}*` };

    }
    throw new Error(`无法获取表达式 '${expr.expression.constructor.name}' 的地址。`);
}

/**
 * 处理 Dereference 表达式。
 * @param generator IR 生成器实例。
 * @param expr DereferenceExpr 表达式。
 * @returns 表达式的 IRValue。
 */
export function visitDereferenceExpr(generator: IRGenerator, expr: DereferenceExpr): IRValue {
    const ptrValue = expr.expression.accept(generator) as IRValue; // 这应该产生一个类型为指针类型 (例如, i32*) 的 IRValue
    let ptrType = ptrValue.type;
    let ptrVar = ptrValue.value;

    if (!ptrType.endsWith('*')) {
        if (ptrType === 'i64' && ptrValue.ptr) {
            ptrVar = ptrValue.ptr;
            ptrType = ptrValue.ptrType || 'i8*';
        } else {
            throw new Error(`解引用操作符 '*' 只能用于指针类型，但得到了 '${ptrValue.type}'。`);
        }
    }

    const baseType = ptrType.slice(0, -1); // 移除 '*' 以获取基础类型
    const resultVar = generator.llvmHelper.getNewTempVar();
    generator.emit(`${resultVar} = load ${baseType}, ${ptrType} ${ptrVar}, align ${generator.llvmHelper.getAlign(baseType)}`);
    return { value: resultVar, type: baseType, address: ptrVar };
}

/**
 * 处理 Identifier 表达式。
 * @param generator IR 生成器实例。
 * @param expr IdentifierExpr 表达式。
 * @returns 表达式的 IRValue。
 */
export function visitIdentifierExpr(generator: IRGenerator, expr: IdentifierExpr): IRValue {
    const name = expr.name.lexeme;

    // 检查是否为捕获的变量
    if (generator.currentFunction && generator.currentFunction.capturedVariables) {
        const captured = (generator.currentFunction.capturedVariables as CapturedVariableInfo[]).find(v => v.name === name);
        if (captured) {
            // 这是一个捕获的变量，通过环境指针访问它
            const envEntry = generator.currentScope.find('__env_ptr');
            if (!envEntry) {
                throw new Error("内部错误：在作用域中未找到闭包环境指针 '__env_ptr'。");
            }
            const envPtr = envEntry.ptr; // 这是环境指针的值, 例如 %arg0
            const envStructType = envEntry.llvmType.slice(0, -1); // 从指针类型获取结构体类型

            const capturedIndex = (generator.currentFunction.capturedVariables as CapturedVariableInfo[]).findIndex(v => v.name === name);

            // 1. 获取指向环境结构体中保存我们变量指针的字段的指针
            const envFieldPtr = generator.llvmHelper.getNewTempVar();
            generator.emit(`${envFieldPtr} = getelementptr inbounds ${envStructType}, ${envEntry.llvmType} ${envPtr}, i32 0, i32 ${capturedIndex}`);

            // 2. 从环境字段中加载我们变量的指针
            const capturedVarAddrPtr = generator.llvmHelper.getNewTempVar();
            const capturedVarType = captured.llvmType; // 例如, i32
            const capturedVarPtrType = `${capturedVarType}*`; // 例如, i32*
            generator.emit(`${capturedVarAddrPtr} = load ${capturedVarPtrType}, ${capturedVarPtrType}* ${envFieldPtr}, align 8`);

            // 3. 使用加载的指针加载变量的实际值
            const loadedValue = generator.llvmHelper.getNewTempVar();
            generator.emit(`${loadedValue} = load ${capturedVarType}, ${capturedVarPtrType} ${capturedVarAddrPtr}, align ${generator.llvmHelper.getAlign(capturedVarType)}`);

            return { value: loadedValue, type: capturedVarType, address: capturedVarAddrPtr };
        }
    }

    if (generator.debug) console.log("Looking up identifier:", name, "in scope depth:", generator.currentScope.depth);
    const entry = generator.currentScope.find(name);

    if (!entry) {
        if (generator.debug) console.log("ERROR: Identifier not found:", name);
        // 特殊处理 'syscall' 内建函数
        if (name === 'syscall') {
            return { value: '__syscall6', type: 'internal_syscall' }; // 使用内部 syscall 包装器
        }
        throw new Error(`未定义变量或函数: ${name} in ${generator.sourceFilePath} at ${expr.name.line}:${expr.name.column}`);
    }
    if (generator.debug) console.log("Found identifier:", name, "entry:", entry);

    // 模块全局变量和函数指针已经是指针，它们的 'ptr' 就是它们的 'value'
    // 对于这些，'value' *就是* 指针/地址，因此我们不需要单独的 'address' 字段。
    if (entry.llvmType === 'module') {
        return { value: entry.ptr, type: entry.llvmType };
    }
    if (entry.llvmType.endsWith(')*')) { // 函数指针
        if (entry.ptr.startsWith('@')) {
            return { value: entry.ptr, type: entry.llvmType };
        }
        const loadedFunc = generator.llvmHelper.getNewTempVar();
        generator.emit(`${loadedFunc} = load ${entry.llvmType}, ${entry.llvmType}* ${entry.ptr}, align ${generator.llvmHelper.getAlign(entry.llvmType)}`);
        return { value: loadedFunc, type: entry.llvmType, address: entry.ptr };
    }

    // 模块全局变量 (结构体)
    for (const info of generator.moduleObjects.values()) {
        if (entry.ptr === info.globalName) { // 例如 @module_io, 其类型为 %struct.module_io*
            // 这里，entry.ptr 是全局模块结构体的地址。
            // 'value' 应该是这个地址，'address' 也应该是这个地址。
            return { value: info.globalName, type: `${info.structName}*`, address: info.globalName };
        }
    }

    const tempVar = generator.llvmHelper.getNewTempVar();
    // `entry.ptr` 是变量在栈上（alloca）或全局（global）的存储地址。
    // `entry.llvmType` 是该变量本身的 LLVM 类型 (例如 i32*, %struct.String, i32)。
    // 我们需要加载 `entry.ptr` 指向的“值”。
    generator.emit(`${tempVar} = load ${entry.llvmType}, ${entry.llvmType}* ${entry.ptr}, align ${generator.llvmHelper.getAlign(entry.llvmType)}`);

    // 返回的 IRValue 包含加载出的值，值的类型，以及变量本身的存储地址。
    return { value: tempVar, type: entry.llvmType, address: entry.ptr };
}

/**
 * 处理 Assign 表达式。
 * @param generator IR 生成器实例。
 * @param expr AssignExpr 表达式。
 * @returns 表达式的 IRValue。
 */
export function visitAssignExpr(generator: IRGenerator, expr: AssignExpr): IRValue {
    const value = expr.value.accept(generator) as IRValue; // 首先评估右侧

    if (expr.target instanceof IdentifierExpr) {
        const varName = expr.target.name.lexeme;

        // 处理闭包内捕获变量的赋值
        if (generator.currentFunction && generator.currentFunction.capturedVariables) {
            const captured = (generator.currentFunction.capturedVariables as CapturedVariableInfo[]).find(v => v.name === varName);
            if (captured) {
                const envEntry = generator.currentScope.find('__env_ptr');
                if (!envEntry) throw new Error("内部错误：在作用域中未找到闭包环境指针 '__env_ptr'。");
                const envPtr = envEntry.ptr;
                const envStructType = envEntry.llvmType.slice(0, -1);
                const capturedIndex = (generator.currentFunction.capturedVariables as CapturedVariableInfo[]).findIndex(v => v.name === varName);

                const envFieldPtr = generator.llvmHelper.getNewTempVar();
                generator.emit(`${envFieldPtr} = getelementptr inbounds ${envStructType}, ${envEntry.llvmType} ${envPtr}, i32 0, i32 ${capturedIndex}`);

                const capturedVarPtr = generator.llvmHelper.getNewTempVar();
                const capturedVarPtrType = `${captured.llvmType}*`;
                generator.emit(`${capturedVarPtr} = load ${capturedVarPtrType}, ${capturedVarPtrType}* ${envFieldPtr}, align 8`);

                const coerced = value.type === captured.llvmType ? value : irgen_utils.coerceValue(generator, value, captured.llvmType);
                generator.emit(`store ${captured.llvmType} ${coerced.value}, ${capturedVarPtrType} ${capturedVarPtr}, align ${generator.llvmHelper.getAlign(captured.llvmType)}`);
                return coerced;
            }
        }

        const entry = generator.currentScope.find(varName);
        if (!entry) {
            throw new Error(`赋值给未声明变量: ${varName}`);
        }
        let toStore = value;
        if (value.type === `${entry.llvmType}*` && entry.llvmType.startsWith('%struct.') && !entry.llvmType.endsWith('*')) {
            const loadedStruct = generator.llvmHelper.getNewTempVar();
            generator.emit(`${loadedStruct} = load ${entry.llvmType}, ${entry.llvmType}* ${value.value}, align ${generator.llvmHelper.getAlign(entry.llvmType)}`);
            toStore = { value: loadedStruct, type: entry.llvmType };
        } else if (value.type !== entry.llvmType) {
            toStore = irgen_utils.coerceValue(generator, value, entry.llvmType);
        }
        generator.emit(`store ${entry.llvmType} ${toStore.value}, ${entry.llvmType}* ${entry.ptr}, align ${generator.llvmHelper.getAlign(entry.llvmType)}`);
        return toStore;
    } else if (expr.target instanceof GetExpr) { // 处理 object.property = value
        const objectInfo = expr.target.object.accept(generator) as IRValue; // 评估对象 (例如，'this')
        const memberName = expr.target.name.lexeme; // 获取属性名

        // 获取对象的类定义
        const objectTypeMatch = objectInfo.type.match(/%struct\.([a-zA-Z0-9_]+)\*/);
        if (!objectTypeMatch || !objectTypeMatch[1]) {
            throw new Error(`无法将属性 '${memberName}' 赋值给非结构体类型: ${objectInfo.type}`);
        }
        const className = objectTypeMatch[1];

        const classEntry = generator.classDefinitions.get(className);
        if (!classEntry) {
            throw new Error(`未定义类型 '${objectInfo.type}' 的类定义。`);
        }

        const memberEntry = classEntry.members.get(memberName);
        if (!memberEntry) {
            throw new Error(`类 '${className}' 中未定义成员 '${memberName}'，用于赋值。`);
        }

        // 获取成员指针
        const memberPtrVar = generator.llvmHelper.getNewTempVar();
        generator.emit(`${memberPtrVar} = getelementptr inbounds ${classEntry.llvmType}, ${objectInfo.type} ${objectInfo.value}, i32 0, i32 ${memberEntry.index}`);

        // 将值存储到成员中
        const coerced = (value.type === `${memberEntry.llvmType}*` && memberEntry.llvmType.startsWith('%struct.'))
            ? (() => {
                const loaded = generator.llvmHelper.getNewTempVar();
                generator.emit(`${loaded} = load ${memberEntry.llvmType}, ${memberEntry.llvmType}* ${value.value}, align ${generator.llvmHelper.getAlign(memberEntry.llvmType)}`);
                return { value: loaded, type: memberEntry.llvmType };
            })()
            : (value.type === memberEntry.llvmType ? value : irgen_utils.coerceValue(generator, value, memberEntry.llvmType));
        generator.emit(`store ${memberEntry.llvmType} ${coerced.value}, ${memberEntry.llvmType}* ${memberPtrVar}, align ${generator.llvmHelper.getAlign(memberEntry.llvmType)}`);
        return coerced;

    } else if (expr.target instanceof DereferenceExpr) { // 处理 *ptr = value
        const targetPtr = expr.target.expression.accept(generator); // 评估 `*ptr` 中的 `ptr`

        if (!targetPtr.type.endsWith('*')) {
            throw new Error(`无法赋值给非指针类型 '${targetPtr.type}' 的解引用结果。`);
        }
        // 指针的基础类型是正在存储的值的类型。
        const baseType = targetPtr.type.slice(0, -1);

        const coerced = value.type === baseType ? value : irgen_utils.coerceValue(generator, value, baseType);
        generator.emit(`store ${baseType} ${coerced.value}, ${targetPtr.type} ${targetPtr.value}, align ${generator.llvmHelper.getAlign(baseType)}`);
        return coerced;
    } else {
        throw new Error(`无效的赋值目标: ${expr.target.constructor.name}`);
    }
}

/**
 * 处理 Get 表达式。
 * @param generator IR 生成器实例。
 * @param expr GetExpr 表达式。
 * @returns 表达式的 IRValue。
 */
export function visitGetExpr(generator: IRGenerator, expr: GetExpr): IRValue {
    const objectInfo = expr.object.accept(generator);
    const memberName = expr.name.lexeme;

    // 模块对象访问
    const moduleInfo = (() => {
        for (const info of generator.moduleObjects.values()) {
            if (objectInfo.type === `${info.structName}*`) return info;
            if (objectInfo.ptr && info.globalName === objectInfo.ptr) return info;
        }
        return null;
    })();

    if (moduleInfo) {
        const member = moduleInfo.members.get(memberName);
        if (!member) {
            throw new Error(`模块对象中未定义成员 '${memberName}'。`);
        }
        const memberPtrVar = generator.llvmHelper.getNewTempVar();
        generator.emit(`${memberPtrVar} = getelementptr inbounds ${moduleInfo.structName}, ${moduleInfo.structName}* ${objectInfo.value}, i32 0, i32 ${member.index}`);
        const loaded = generator.llvmHelper.getNewTempVar();
        generator.emit(`${loaded} = load ${member.llvmType}, ${member.llvmType}* ${memberPtrVar}, align ${generator.llvmHelper.getAlign(member.llvmType)}`);
        return { value: loaded, type: member.llvmType };
    }

    // 处理 array.len 和 array.cap 访问
    if (objectInfo.type.startsWith(LangItems.array.structPrefix)) {
        const arrayStructType = objectInfo.type;
        const arrayPtr = objectInfo.address || objectInfo.value;

        if (!arrayPtr) {
            throw new Error(`无法获取非可寻址数组值的成员 '${memberName}'。`);
        }

        let memberIndex: number;
        let memberLlvmType: string;

        switch (memberName) {
            case 'len':
                memberIndex = LangItems.array.members.len.index;
                memberLlvmType = LangItems.array.members.len.type;
                break;
            case 'cap':
                memberIndex = LangItems.array.members.cap.index;
                memberLlvmType = LangItems.array.members.cap.type;
                break;
            case 'ptr':
                memberIndex = LangItems.array.members.ptr.index;
                memberLlvmType = LangItems.array.members.ptr.type;
                break;
            default:
                throw new Error(`数组类型 '${arrayStructType}' 中未定义成员 '${memberName}'。`);
        }

        const memberPtrVar = generator.llvmHelper.getNewTempVar();
        generator.emit(`${memberPtrVar} = getelementptr inbounds ${arrayStructType}, ${arrayStructType}* ${arrayPtr}, i32 0, i32 ${memberIndex}`);
        const loadedValue = generator.llvmHelper.getNewTempVar();
        generator.emit(`${loadedValue} = load ${memberLlvmType}, ${memberLlvmType}* ${memberPtrVar}, align ${generator.llvmHelper.getAlign(memberLlvmType)}`);
        return { value: loadedValue, type: memberLlvmType };
    }

    // --- 通用结构体成员访问 ---
    const isPointer = objectInfo.type.endsWith('*');
    const baseType = isPointer ? objectInfo.type.slice(0, -1) : objectInfo.type;

    if (!baseType.startsWith('%struct.')) {
        throw new Error(`无法获取非结构体类型 '${objectInfo.type}' 的属性 '${memberName}'。`);
    }

    const className = baseType.substring('%struct.'.length);
    const classEntry = generator.classDefinitions.get(className);
    if (!classEntry) {
        throw new Error(`未定义类型 '${objectInfo.type}' 的类定义。`);
    }

    // 检查方法
    const methodEntry = classEntry.methods.get(memberName);
    if (methodEntry) {
        const returnType = generator.llvmHelper.getLLVMType(methodEntry.returnType);
        const paramsList = methodEntry.parameters.map(p => generator.llvmHelper.getLLVMType(p.type));
        const instancePtrType = `${classEntry.llvmType}*`;
        let funcType: string;
        if (returnType.startsWith('%struct.') && !returnType.endsWith('*')) {
            funcType = `void (${returnType}*, ${instancePtrType}${paramsList.length ? ', ' + paramsList.join(', ') : ''})*`;
        } else {
            funcType = `${returnType} (${instancePtrType}${paramsList.length ? ', ' + paramsList.join(', ') : ''})*`;
        }
        const mangledName = `_cls_${className}_${methodEntry.name.lexeme}`;
        return { value: `@${mangledName}`, type: funcType, classInstancePtr: objectInfo.value, classInstancePtrType: objectInfo.type };
    }

    // 检查属性
    const memberEntry = classEntry.members.get(memberName);
    if (!memberEntry) {
        throw new Error(`类 '${className}' 中未定义成员 '${memberName}'。`);
    }

    let resultVar: string;
    if (isPointer) {
        const memberPtrVar = generator.llvmHelper.getNewTempVar();
        generator.emit(`${memberPtrVar} = getelementptr inbounds ${classEntry.llvmType}, ${objectInfo.type} ${objectInfo.value}, i32 0, i32 ${memberEntry.index}`);
        resultVar = generator.llvmHelper.getNewTempVar();
        generator.emit(`${resultVar} = load ${memberEntry.llvmType}, ${memberEntry.llvmType}* ${memberPtrVar}, align ${generator.llvmHelper.getAlign(memberEntry.llvmType)}`);
    } else {
        resultVar = generator.llvmHelper.getNewTempVar();
        generator.emit(`${resultVar} = extractvalue ${objectInfo.type} ${objectInfo.value}, ${memberEntry.index}`);
    }

    return { value: resultVar, type: memberEntry.llvmType };
}

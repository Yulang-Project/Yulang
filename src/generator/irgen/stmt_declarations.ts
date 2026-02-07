// src/generator/irgen/stmt_declarations.ts

import {
    LetStmt, ConstStmt, LiteralExpr, ArrayTypeAnnotation
} from '../../ast.js';
import * as irgen_utils from './ir_generator_utils.js'; // Added import for irgen_utils
import { LangItems } from '../lang_items.js';
import { IRGenerator } from './ir_generator_base.js';
import type { IRValue } from './types_scopes.js';

/**
 * 处理 Let 语句。
 * @param generator IR 生成器实例。
 * @param stmt LetStmt 语句。
 */
export function visitLetStmt(generator: IRGenerator, stmt: LetStmt): void {
    // 检查这是全局变量还是局部变量
    if (generator.currentScope === generator.globalScope) {
        visitGlobalLetStmt(generator, stmt);
    } else {
        visitLocalLetStmt(generator, stmt);
    }
}

/**
 * 处理 Const 语句。
 * @param generator IR 生成器实例。
 * @param stmt ConstStmt 语句。
 */
export function visitConstStmt(generator: IRGenerator, stmt: ConstStmt): void {
    const varName = stmt.name.lexeme;
    const mangledName = `@${varName}`;
    const llvmType = generator.llvmHelper.getLLVMType(stmt.type);
    const linkage = stmt.isExported ? '' : 'internal ';

    let initialValue = 'zeroinitializer'; // 全局常量的默认值
    if (stmt.initializer) {
        if (stmt.initializer instanceof LiteralExpr) {
            const literal = generator.visitLiteralExpr(stmt.initializer);
            initialValue = literal.value;
        } else {
            throw new Error("全局常量初始化器必须是常量字面量。");
        }
    }

    generator.globalScope.define(varName, {
        llvmType: llvmType,
        ptr: mangledName,
        isPointer: llvmType.endsWith('*'),
        definedInScopeDepth: generator.currentScope.depth
    });
}

/**
 * 处理全局 Let 语句。
 * @param generator IR 生成器实例。
 * @param stmt LetStmt 语句。
 */
export function visitGlobalLetStmt(generator: IRGenerator, stmt: LetStmt): void {
    const varName = stmt.name.lexeme;
    const mangledName = `@${varName}`;
    const llvmType = generator.llvmHelper.getLLVMType(stmt.type);
    const linkage = stmt.isExported ? '' : 'internal ';

    let initialValue = '0';
    if (stmt.initializer) {
        if (stmt.initializer instanceof LiteralExpr) {
            const literal = generator.visitLiteralExpr(stmt.initializer);
            initialValue = literal.value;
        } else {
            throw new Error("全局变量初始化器必须是常量字面量。");
        }
    }

    generator.emit(`${mangledName} = ${linkage}global ${llvmType} ${initialValue}, align ${generator.llvmHelper.getAlign(llvmType)}`, false);

    generator.globalScope.define(varName, {
        llvmType: llvmType,
        ptr: mangledName,
        isPointer: llvmType.endsWith('*'),
        definedInScopeDepth: generator.currentScope.depth
    });
}

/**
 * 处理局部 Let 语句。
 * @param generator IR 生成器实例。
 * @param stmt LetStmt 语句。
 */
export function visitLocalLetStmt(generator: IRGenerator, stmt: LetStmt): void {
    const varName = stmt.name.lexeme;
    let llvmType: string;
    let initValue: IRValue | null = null;

    if (stmt.type) { // 显式类型注解
        llvmType = generator.llvmHelper.getLLVMType(stmt.type);
        // 如果是数组类型，确保其定义被发出。
        if (stmt.type instanceof ArrayTypeAnnotation) { // 直接检查 ArrayTypeAnnotation 实例
            generator.llvmHelper.ensureArrayStructDefinition(generator.llvmHelper.getLLVMType(stmt.type.elementType));
        }
        if (stmt.initializer) {
            // 为对象字面量传递预期结构体类型
            generator.objectLiteralExpectedStructType = (llvmType.startsWith('%struct.') && !llvmType.endsWith('*')) ? llvmType : null;
            initValue = stmt.initializer.accept(generator);
            generator.objectLiteralExpectedStructType = null;
        }
    } else {
        if (stmt.initializer) {
            initValue = stmt.initializer.accept(generator);
        }
        if (initValue) { // 从初始化器推断类型
            // 字符串字面量推断为值类型 string（结构体）
            if (initValue.type === `${LangItems.string.structName}*` && !initValue.type.endsWith(')*')) { // 排除函数指针
                llvmType = LangItems.string.structName;
            } else if (initValue.type.startsWith(LangItems.array.structPrefix)) { // 新增：数组类型推断
                llvmType = initValue.type;
            } else if (initValue.ptrType) {
                // 地址推断为指针类型
                llvmType = initValue.ptrType;
            } else {
                llvmType = initValue.type;
            }
        } else {
            throw new Error(`变量 '${varName}' 声明时必须指定类型或提供初始化器。`);
        }
    }

    if (generator.debug) console.log(`Let ${varName} inferred LLVM type: ${llvmType}, initValue.type: ${initValue ? initValue.type : 'null'}`);

    const varPtr = `%${varName}`;
    generator.emit(`${varPtr} = alloca ${llvmType}, align ${generator.llvmHelper.getAlign(llvmType)}`);

    generator.currentScope.define(varName, {
        llvmType: llvmType,
        ptr: varPtr,
        isPointer: llvmType.endsWith('*'),
        definedInScopeDepth: generator.currentScope.depth
    });

    if (initValue) {
        // 如果初始化器是结构体指针 (%struct.String*) 且变量是结构体值 (%struct.String)
        if (initValue.type === `${llvmType}*` && !llvmType.endsWith('*') && llvmType.startsWith('%struct.')) {
            const loadedStruct = generator.llvmHelper.getNewTempVar();
            generator.emit(`${loadedStruct} = load ${llvmType}, ${llvmType}* ${initValue.value}, align ${generator.llvmHelper.getAlign(llvmType)}`);
            generator.emit(`store ${llvmType} ${loadedStruct}, ${llvmType}* ${varPtr}, align ${generator.llvmHelper.getAlign(llvmType)}`);
        } else if (llvmType.startsWith(LangItems.array.structPrefix) && initValue.type.startsWith(LangItems.array.structPrefix)) {
            // 直接复制数组结构体值
            const coerced = irgen_utils.coerceValue(generator, initValue, llvmType);
            generator.emit(`store ${llvmType} ${coerced.value}, ${llvmType}* ${varPtr}, align ${generator.llvmHelper.getAlign(llvmType)}`);
        } else {
            const coerced = irgen_utils.coerceValue(generator, initValue, llvmType);
            generator.emit(`store ${llvmType} ${coerced.value}, ${llvmType}* ${varPtr}, align ${generator.llvmHelper.getAlign(llvmType)}`);
        }
    } else if (llvmType.startsWith(LangItems.array.structPrefix)) { // 新增：默认初始化空数组
        // 默认初始化数组为 { null, 0, 0 }
        const elementTypeLlvmType = generator.llvmHelper.getLLVMType((stmt.type as ArrayTypeAnnotation).elementType);
        const elementPtrType = generator.llvmHelper.getPointerType(elementTypeLlvmType);
        const nullPtr = 'null';
        const zeroI64 = '0';
        generator.emit(`store ${llvmType} { ${elementPtrType} ${nullPtr}, i64 ${zeroI64}, i64 ${zeroI64} }, ${llvmType}* ${varPtr}, align ${generator.llvmHelper.getAlign(llvmType)}`);
    }
}
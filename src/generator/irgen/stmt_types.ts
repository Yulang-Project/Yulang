// src/generator/irgen/stmt_types.ts

import {
    ClassDeclaration, StructDeclaration, PropertyDeclaration, FunctionDeclaration
} from '../../ast.js';
import { LangItems } from '../lang_items.js'; // Used as value
import type { IRGenerator } from './ir_generator_base.js'; // Used as type
import type { MemberEntry } from './types_scopes.js';
import { Scope } from './types_scopes.js';

/**
 * 处理 ClassDeclaration。
 * @param generator IR 生成器实例。
 * @param stmt ClassDeclaration 声明。
 */
export function visitClassDeclaration(generator: IRGenerator, stmt: ClassDeclaration): void {
    const className = stmt.name.lexeme;
    const structName = (className === LangItems.string.className)
        ? LangItems.string.structName
        : `%struct.${className}`;

    const fields: string[] = [];
    const membersMap: Map<string, MemberEntry> = new Map();
    const methodsMap: Map<string, FunctionDeclaration> = new Map();

    stmt.properties.forEach((p, index) => {
        const memberType = generator.llvmHelper.getLLVMType(p.type);
        fields.push(memberType);
        membersMap.set(p.name.lexeme, { llvmType: memberType, index: index });
    });

    stmt.methods.forEach(m => {
        methodsMap.set(m.name.lexeme, m);
    });

    generator.emit(`${structName} = type { ${fields.join(', ')} }`, false);

    generator.classDefinitions.set(className, {
        llvmType: structName,
        members: membersMap,
        methods: methodsMap
    });

    // 发出方法定义
    stmt.methods.forEach(method => {
        const savedScope = generator.currentScope;
        // 创建一个包含 'this' 的作用域，以便 FunctionDeclaration 将其视为方法
        const methodScope = new Scope(generator.globalScope);
        methodScope.define("this", {
            llvmType: `${structName}*`,
            ptr: '%this',
            isPointer: true,
            definedInScopeDepth: methodScope.depth
        });
        generator.currentScope = methodScope;
        generator.visitFunctionDeclaration(method);
        generator.currentScope = savedScope;
    });
}

/**
 * 处理 StructDeclaration。
 * @param generator IR 生成器实例。
 * @param decl StructDeclaration 声明。
 */
export function visitStructDeclaration(generator: IRGenerator, decl: StructDeclaration): void {
    const structName = `%struct.${decl.name.lexeme}`;

    const fields: string[] = [];
    const membersMap: Map<string, MemberEntry> = new Map();

    decl.properties.forEach((p: PropertyDeclaration, index: number) => {
        const memberType = generator.llvmHelper.getLLVMType(p.type);
        fields.push(memberType);
        membersMap.set(p.name.lexeme, { llvmType: memberType, index: index });
    });

    generator.emit(`${structName} = type { ${fields.join(', ')} }`, false);

    // 存储结构体定义以供后续成员访问
    // 重用 classDefinitions map，但结构体没有方法
    generator.classDefinitions.set(decl.name.lexeme, {
        llvmType: structName,
        members: membersMap,
        methods: new Map() // 结构体没有方法
    });
}

/**
 * 处理 PropertyDeclaration。
 * @param generator IR 生成器实例。
 * @param stmt PropertyDeclaration 语句。
 */
export function visitPropertyDeclaration(generator: IRGenerator, stmt: PropertyDeclaration): void { /* 由 ClassDeclaration 处理 */ }

// src/generator/irgen/stmt_modules.ts

import {
    ImportStmt, UsingStmt
} from '../../ast.js';
import * as path from 'path';
import { IRGenerator } from './ir_generator_base.js';
import { buildModuleObject } from './module_handling.js';

/**
 * 处理 Import 语句。
 * @param generator IR 生成器实例。
 * @param stmt ImportStmt 语句。
 */
export function visitImportStmt(generator: IRGenerator, stmt: ImportStmt): void {
    const sourcePath = stmt.sourcePath.literal as string;
    const namespaceAlias = stmt.namespaceAlias ? stmt.namespaceAlias.lexeme : null;

    // 解析模块路径 (镜像 declaration_parser)
    const currentFileDir = path.dirname(generator.sourceFilePath);
    let fullModulePath: string;

    if (sourcePath === 'std' || sourcePath.startsWith('std/')) {
        fullModulePath = generator.parser.finder.getStdLibModulePath(
            generator.parser.osIdentifier,
            generator.parser.archIdentifier,
            sourcePath
        );
    } else if (path.isAbsolute(sourcePath) || sourcePath.startsWith('/')) {
        fullModulePath = path.resolve(sourcePath + '.yu');
    } else {
        const currentFileDir = path.dirname(generator.parser.currentFilePath);
        fullModulePath = path.resolve(currentFileDir, sourcePath + '.yu');
    }


    // 构建模块对象 (静态密封) 并放置在全局作用域
    buildModuleObject(generator, fullModulePath);

    const moduleInfo = generator.moduleObjects.get(fullModulePath);
    if (!moduleInfo) {
        throw new Error(`无法为 ${fullModulePath} 构建模块对象`);
    }

    const moduleLookupName = namespaceAlias || fullModulePath; // 如果存在别名，则使用别名，否则使用完整路径

    // 这将变量 `io` 定义为指向模块结构体的指针。
    generator.globalScope.define(moduleLookupName, {
        llvmType: `${moduleInfo.structName}*`,
        ptr: moduleInfo.globalName,
        isPointer: true,
        definedInScopeDepth: generator.globalScope.depth
    });
}

/**
 * 处理 Using 语句。
 * @param generator IR 生成器实例。
 * @param stmt UsingStmt 语句。
 */
export function visitUsingStmt(generator: IRGenerator, stmt: UsingStmt): void {
    // 目前，`using` 声明不直接生成任何 IR。
    // 它们主要用于提供类型信息或链接到外部库，
    // 这将在语义分析或链接器阶段处理。
}

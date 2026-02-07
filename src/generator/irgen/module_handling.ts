// src/generator/irgen/module_handling.ts

import * as path from 'path';
import * as process from 'process';

import { LLVMIRHelper } from '../llvm_ir_helpers.js';
import { BuiltinFunctions } from '../builtins.js';
import { LangItems } from '../lang_items.js';
import type { IPlatform } from '../../platform/IPlatform.js';
import { ImportStmt, StructDeclaration, ClassDeclaration, FunctionDeclaration, DeclareFunction } from '../../ast.js';
import type {
    IRValue,
    MemberEntry,
    ModuleMember
} from './types_scopes.js';
import { IRGenerator } from './ir_generator_base.js';

/**
 * 构建模块对象。
 * @param generator IR 生成器实例。
 * @param fullModulePath 模块的完整路径。
 */
export function buildModuleObject(generator: IRGenerator, fullModulePath: string): void {
    if (generator.moduleObjects.has(fullModulePath)) return;
    const moduleStatements = generator.parser.moduleDeclarations.get(fullModulePath);
    if (!moduleStatements) {
        throw new Error(`未找到模块语句: ${fullModulePath}`);
    }

    const relativeModulePath = path.relative(process.cwd(), fullModulePath);
    const moduleNamePart = relativeModulePath.replace(/\.yu$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
    const structName = `%struct.module_${moduleNamePart}`;
    const globalName = `@module_${moduleNamePart}`;
    const members: Map<string, ModuleMember> = new Map();
    const fieldTypes: string[] = [];
    const initValues: string[] = [];

    moduleStatements.forEach(stmt => {
        if (stmt instanceof ImportStmt) {
            generator.visitImportStmt(stmt);
        }
    });

    moduleStatements.forEach(stmt => {
        if (stmt instanceof StructDeclaration) {
            generator.visitStructDeclaration(stmt);
        } else if (stmt instanceof ClassDeclaration) {
            generator.visitClassDeclaration(stmt);
        }
    });

    let index = 0;
    moduleStatements.forEach(stmt => {
        if (stmt instanceof FunctionDeclaration) {
            if (!stmt.isExported) return;

            const originalFuncName = stmt.name.lexeme;
            const mangledName = `_mod_${moduleNamePart}_${originalFuncName}`;
            const fullName = `@${mangledName}`;

            const llvmReturnType = generator.llvmHelper.getLLVMType(stmt.returnType);
            const paramTypes = stmt.parameters.map(p => generator.llvmHelper.getLLVMType(p.type));
            const isSret = llvmReturnType.startsWith('%struct.') && !llvmReturnType.endsWith('*');
            const funcParamTypes = isSret ? [`${llvmReturnType}*`, ...paramTypes] : paramTypes;
            const funcType = isSret
                ? `void (${funcParamTypes.join(', ')})*`
                : `${llvmReturnType} (${funcParamTypes.join(', ')})*`;

            if (!generator.generatedFunctions.has(`${fullModulePath}.${originalFuncName}`)) {
                const savedPath = generator.sourceFilePath;
                const savedMangleFlag = generator.mangleStdLib;
                generator.sourceFilePath = fullModulePath;
                generator.mangleStdLib = false;
                generator.visitFunctionDeclaration(stmt);
                generator.sourceFilePath = savedPath;
                generator.mangleStdLib = savedMangleFlag;
                generator.generatedFunctions.add(`${fullModulePath}.${originalFuncName}`);
            }

            members.set(originalFuncName, { llvmType: funcType, index, ptr: fullName });
            fieldTypes.push(funcType);
            initValues.push(`${funcType} ${fullName}`);
            index++;
        } else if (stmt instanceof DeclareFunction) {
            const originalFuncName = stmt.name.lexeme;
            const mangledName = `_mod_${moduleNamePart}_${originalFuncName}`;
            const fullName = `@${mangledName}`;

            const llvmReturnType = generator.llvmHelper.getLLVMType(stmt.returnType);
            const paramTypes = stmt.parameters.map(p => generator.llvmHelper.getLLVMType(p.type));
            const isSret = llvmReturnType.startsWith('%struct.') && !llvmReturnType.endsWith('*');
            const funcParamTypes = isSret ? [`${llvmReturnType}*`, ...paramTypes] : paramTypes;
            const funcType = isSret
                ? `void (${funcParamTypes.join(', ')})*`
                : `${llvmReturnType} (${funcParamTypes.join(', ')})*`;

            if (isSret) {
                const sretAlign = generator.llvmHelper.getAlign(llvmReturnType);
                const paramsString = [`ptr sret(${llvmReturnType}) align ${sretAlign}`, ...paramTypes].filter(p => p.length > 0).join(', ');
                generator.emit(`declare void ${fullName}(${paramsString})`, false);
            } else {
                const paramsString = paramTypes.join(', ');
                generator.emit(`declare ${llvmReturnType} ${fullName}(${paramsString})`, false);
            }

            members.set(originalFuncName, { llvmType: funcType, index, ptr: fullName });
            fieldTypes.push(funcType);
            initValues.push(`${funcType} ${fullName}`);
            index++;
        } else if (stmt instanceof ClassDeclaration) {
            if (!stmt.isExported) return;

            const className = stmt.name.lexeme;
            const structType = `%struct.${className}`;
            const classPtrType = `${structType}*`;

            generator.visitClassDeclaration(stmt);

            members.set(className, { llvmType: classPtrType, index, ptr: structType });
            fieldTypes.push(classPtrType);
            initValues.push(`${classPtrType} null`);
            index++;
        } else if (stmt instanceof StructDeclaration) {
            if (!stmt.isExported) return;

            const structName = stmt.name.lexeme;
            const structLlvmType = `%struct.${structName}`;
            const structPtrType = `${structLlvmType}*`;

            generator.visitStructDeclaration(stmt);

            members.set(structName, { llvmType: structPtrType, index, ptr: structLlvmType });
            fieldTypes.push(structPtrType);
            initValues.push(`${structPtrType} null`);
            index++;
        }
    });

    generator.emit(`${structName} = type { ${fieldTypes.join(', ')} }`, false);
    generator.emit(`${globalName} = internal global ${structName} { ${initValues.join(', ')} }`, false);

    generator.moduleObjects.set(fullModulePath, {
        structName,
        globalName,
        members,
        initialized: true
    });
}

// src/generator/irgen/stmt_functions.ts

import {
    FunctionDeclaration, DeclareFunction
} from '../../ast.js';
import * as path from 'path';
import * as process from 'process';
import { LangItems } from '../lang_items.js';
import { IRGenerator } from './ir_generator_base.js';
import { findPredefinedFunction } from '../../predefine/funs.js';

/**
 * 处理 FunctionDeclaration。
 * @param generator IR 生成器实例。
 * @param decl FunctionDeclaration 声明。
 */
export function visitFunctionDeclaration(generator: IRGenerator, decl: FunctionDeclaration): void {
    const key = generator.getFunctionKey(decl);
    if (!generator.declaredSymbols.has(key)) {
        declareFunctionSymbol(generator, decl);
        generator.declaredSymbols.add(key);
    }
    if (!generator.generatedFunctions.has(key)) {
        emitFunctionDefinition(generator, decl);
        generator.generatedFunctions.add(key);
    }
}

/**
 * 声明函数符号。
 * @param generator IR 生成器实例。
 * @param decl FunctionDeclaration 声明。
 */
export function declareFunctionSymbol(generator: IRGenerator, decl: FunctionDeclaration): void {
    generator.currentFunction = decl; // 暂时设置 currentFunction 以获取上下文
    const originalFuncName = decl.name.lexeme;
    let funcNameInIR = originalFuncName;

    if (generator.debug) console.log("为函数声明符号:", originalFuncName);

    // 确定全局函数的混淆名称
    if (decl.isExported) {
        const relativeSourcePath = path.relative(process.cwd(), generator.sourceFilePath);
        const moduleNamePart = relativeSourcePath.replace(/\.yu$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
        funcNameInIR = `_mod_${moduleNamePart}_${originalFuncName}`;
    } else if (generator.mangleStdLib && originalFuncName !== 'main') {
        funcNameInIR = `_prog_${originalFuncName}`;
    }

    // 处理类方法混淆
    if (decl.visibility && decl.visibility.lexeme) {
        // ... (此处逻辑与 emitFunctionDefinition 中的类方法处理保持一致)
    }
    const mangledName = `@${funcNameInIR}`;

    // 确定 LLVM 返回类型
    let llvmReturnType = generator.llvmHelper.getLLVMType(decl.returnType);
    let isSretReturn = false;
    if (llvmReturnType.startsWith('%struct.') && !llvmReturnType.endsWith('*')) {
        isSretReturn = true;
        llvmReturnType = 'void'; // SRET 的有效返回类型
    }

    // 确定签名的参数类型
    let signatureParamTypesOnly: string[] = [];

    // 如果需要，添加 SRET 参数
    if (isSretReturn) {
        signatureParamTypesOnly.push(`${generator.llvmHelper.getLLVMType(decl.returnType)}*`); // SRET 指针类型
    }

    // 添加用户定义参数
    decl.parameters.forEach(p => {
        let paramType = generator.llvmHelper.getLLVMType(p.type);
        if (paramType.startsWith('%struct.') && paramType !== LangItems.string.structName) {
            paramType = `${paramType}*`;
        }
        signatureParamTypesOnly.push(paramType);
    });

    const funcType = `${llvmReturnType} (${signatureParamTypesOnly.join(', ')})*`; // 完整函数指针类型

    generator.globalScope.define(originalFuncName, { llvmType: funcType, ptr: mangledName, isPointer: true, definedInScopeDepth: generator.globalScope.depth });
    if (generator.debug) console.log("声明符号:", originalFuncName, "混淆名:", mangledName, "类型:", funcType);
}

/**
 * 发出函数定义。
 * @param generator IR 生成器实例。
 * @param decl FunctionDeclaration 声明。
 */
export function emitFunctionDefinition(generator: IRGenerator, decl: FunctionDeclaration): void {
    generator.currentFunction = decl;
    const originalFuncName = decl.name.lexeme;
    let funcNameInIR = originalFuncName;

    if (generator.debug) console.log("为函数发出定义:", originalFuncName);

    // 重新确定混淆名称 (必须与 declareFunctionSymbol 保持一致)
    if (decl.isExported) {
        const relativeSourcePath = path.relative(process.cwd(), generator.sourceFilePath);
        const moduleNamePart = relativeSourcePath.replace(/\.yu$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
        funcNameInIR = `_mod_${moduleNamePart}_${originalFuncName}`;
    } else if (generator.mangleStdLib && originalFuncName !== 'main') {
        funcNameInIR = `_prog_${originalFuncName}`;
    }

    // 处理类方法混淆
    const isClassMethod = (generator.currentScope !== generator.globalScope && decl.visibility && decl.visibility.lexeme);
    if (isClassMethod) {
        const thisEntry = generator.currentScope.find("this");
        if (thisEntry && thisEntry.llvmType.startsWith('%struct.')) {
            const classNameMatch = thisEntry.llvmType.match(/%struct\.([a-zA-Z0-9_]+)\*/);
            if (classNameMatch && classNameMatch[1]) {
                const className = classNameMatch[1];
                funcNameInIR = `_cls_${className}_${originalFuncName}`; // 使用类方法混淆
            }
        }
    }
    const mangledName = `@${funcNameInIR}`;

    const linkage = (originalFuncName === 'main' || decl.isExported) ? '' : 'internal ';

    let llvmReturnType = generator.llvmHelper.getLLVMType(decl.returnType);
    let isSretReturn = false;
    if (llvmReturnType.startsWith('%struct.') && !llvmReturnType.endsWith('*')) {
        isSretReturn = true;
        llvmReturnType = 'void';
    }

    let signatureParamsList: string[] = [];
    let sretArgName: string | null = null;
    generator.sretPointer = null;

    if (isSretReturn) {
        sretArgName = `%agg.result`;
        signatureParamsList.push(`ptr sret(${generator.llvmHelper.getLLVMType(decl.returnType)}) align ${generator.llvmHelper.getAlign(generator.llvmHelper.getLLVMType(decl.returnType))} ${sretArgName}`);
        generator.sretPointer = sretArgName;
    }

    const hasImplicitThis = isClassMethod; // 如果是类方法，则有 'this'
    if (hasImplicitThis) {
        // 从类设置中重用信息，假设它正确存在
        const classEntry = generator.classDefinitions.get(generator.currentScope.find("this")?.llvmType.slice(8, -1) || '');
        if (classEntry) {
            signatureParamsList.push(`${classEntry.llvmType}* %this`);
        } else {
            signatureParamsList.push(`i8* %this`); // 如果未找到类，则回退
        }
    }

    decl.parameters.forEach(p => {
        let paramType = generator.llvmHelper.getLLVMType(p.type);
        if (paramType.startsWith('%struct.') && paramType !== LangItems.string.structName) {
            paramType = `${paramType}*`;
        }
        signatureParamsList.push(`${paramType} %${p.name.lexeme}`);
    });

    const paramsString = signatureParamsList.join(', ');

    generator.emit(`define ${linkage}${llvmReturnType} ${mangledName}(${paramsString}) {`, false);
    generator.indentLevel++;
    generator.emit('entry:', false);
    generator.enterScope();

    if (isSretReturn && sretArgName) {
        generator.currentScope.define(sretArgName, {
            llvmType: `${generator.llvmHelper.getLLVMType(decl.returnType)}*`,
            ptr: sretArgName,
            isPointer: true,
            definedInScopeDepth: generator.currentScope.depth
        });
    }

    if (hasImplicitThis) {
        const thisEntry = generator.currentScope.find("this"); // 从外部类作用域
        if (thisEntry) {
            const thisPtr = `%this.ptr`;
            const thisLlvmType = thisEntry.llvmType; // 这将是 %struct.MyClass*
            generator.emit(`${thisPtr} = alloca ${thisLlvmType}, align ${generator.llvmHelper.getAlign(thisLlvmType)}`);
            generator.emit(`store ${thisLlvmType} %this, ${thisLlvmType}* ${thisPtr}, align ${generator.llvmHelper.getAlign(thisLlvmType)}`);
            generator.currentScope.define("this", { // 使用 alloca 的指针覆盖
                llvmType: thisLlvmType,
                ptr: thisPtr,
                isPointer: true,
                definedInScopeDepth: generator.currentScope.depth
            });
        }
    }

    decl.parameters.forEach(p => {
        let paramType = generator.llvmHelper.getLLVMType(p.type);
        if (paramType.startsWith('%struct.') && paramType !== LangItems.string.structName) {
            paramType = `${paramType}*`;
        }
        const paramName = p.name.lexeme;
        const paramPtr = `%p.${paramName}`;
        const incomingArgName = `%${paramName}`;

        generator.emit(`${paramPtr} = alloca ${paramType}, align ${generator.llvmHelper.getAlign(paramType)}`);
        generator.emit(`store ${paramType} ${incomingArgName}, ${paramType}* ${paramPtr}, align ${generator.llvmHelper.getAlign(paramType)}`);

        generator.currentScope.define(paramName, {
            llvmType: paramType,
            ptr: paramPtr,
            isPointer: paramType.endsWith('*'),
            definedInScopeDepth: generator.currentScope.depth
        });
    });

    decl.body.accept(generator);

    const lastLine = generator.builder[generator.builder.length - 1];
    if (lastLine !== undefined && !lastLine.trim().startsWith('ret ') && !lastLine.trim().startsWith('br ')) {
        if (llvmReturnType === 'void') {
            generator.emit(`ret void`);
        } else {
            generator.emit(`unreachable`);
        }
    }

    generator.exitScope();
    generator.indentLevel--;
    generator.emit('}', false);
    generator.emit('', false);
    generator.currentFunction = null;
    generator.sretPointer = null;
}

/**
 * 处理 DeclareFunction。
 * @param generator IR 生成器实例。
 * @param decl DeclareFunction 声明。
 */
export function visitDeclareFunction(generator: IRGenerator, decl: DeclareFunction): void {
    const originalFuncName = decl.name.lexeme; // 存储原始名称
    let funcNameInIR = originalFuncName;

    if (generator.mangleStdLib) {
        funcNameInIR = `_prog_${funcNameInIR}`;
    }
    const mangledName = `@${funcNameInIR}`;

    const returnType = generator.llvmHelper.getLLVMType(decl.returnType);
    const paramsList = decl.parameters.map(p => generator.llvmHelper.getLLVMType(p.type));
    const paramsString = paramsList.join(', ');

    const funcType = `${returnType} (${paramsList.join(', ')})`;

    // 检查是否是预定义函数，如果是，则跳过显式声明
    if (findPredefinedFunction(originalFuncName)) {
        // 预定义函数通常有自己的声明方式或不需要显式声明
        return;
    }

    // 对于声明的函数，我们假设它们是函数指针。
    generator.globalScope.define(originalFuncName, { llvmType: `${funcType}*`, ptr: mangledName, isPointer: true, definedInScopeDepth: generator.globalScope.depth });

    generator.emit(`declare ${returnType} ${mangledName}(${paramsString})`, false);
}

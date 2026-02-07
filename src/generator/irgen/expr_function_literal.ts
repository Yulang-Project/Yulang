// src/generator/irgen/expr_function_literal.ts

import {
    FunctionLiteralExpr, FunctionDeclaration
} from '../../ast.js';
import { Token, TokenType } from '../../token.js';
import { LangItems } from '../lang_items.js';
import { ClosureAnalyzer } from './types_scopes.js';
import { IRGenerator } from './ir_generator_base.js';
import type { IRValue } from './types_scopes.js';

/**
 * 处理 FunctionLiteral 表达式。
 * @param generator IR 生成器实例。
 * @param expr FunctionLiteralExpr 表达式。
 * @returns 表达式的 IRValue。
 */
export function visitFunctionLiteralExpr(generator: IRGenerator, expr: FunctionLiteralExpr): IRValue {
    const uniqueFunctionName = generator.llvmHelper.getNewUniqueName('closure_func');

    // 步骤 1: 分析捕获的变量
    // 此时的 `generator.currentScope` 是函数字面量 *包围* 的作用域。
    // 函数字面量的主体将在 `generator.currentScope.depth + 1` 创建一个新作用域。
    const analyzer = new ClosureAnalyzer(generator.currentScope, generator.currentScope.depth + 1);
    expr.body.accept(analyzer); // 分析函数字面量的主体
    const capturedVariables = analyzer.getCapturedVariables();

    // 步骤 2 & 3: 环境结构体定义和 LLVM 函数签名
    let envStructType: string | null = null; // 环境结构体的 LLVM 类型 (例如, %struct.closure_env_func_X)
    let envStructPtrType: string | null = null; // 指向环境结构体的 LLVM 指针类型 (例如, %struct.closure_env_func_X*)
    let envInstancePtr: string | null = null; // 指向堆上环境结构体实例的指针

    // 如果有捕获的变量，则定义环境结构体
    if (capturedVariables.length > 0) {
        envStructType = `%struct.closure_env_${uniqueFunctionName}`;
        const envFields = capturedVariables.map(cv => `${cv.llvmType}*`); // 环境存储指向捕获变量的指针
        generator.emitHoisted(`${envStructType} = type { ${envFields.join(', ')} }`);
        envStructPtrType = `${envStructType}*`;
    }

    // 确定实际 LLVM 函数的 *内部* 签名 (env_ptr 作为第一个参数)
    const originalParamLlvmTypes = expr.parameters.map(p => {
        let type = generator.llvmHelper.getLLVMType(p.type);
        // 对作为函数参数的用户定义结构体应用引用传递
        if (type.startsWith('%struct.') && type !== LangItems.string.structName) {
            type = `${type}*`;
        }
        return type;
    });

    // 始终将 env 指针 (i8*) 作为第一个参数，用于统一闭包调用。
    let closureFuncLlvmParams: string[] = ['i8*'];
    closureFuncLlvmParams.push(...originalParamLlvmTypes);

    const returnLlvmType = generator.llvmHelper.getLLVMType(expr.returnType);

    // 实际 LLVM 函数的最终函数类型 (用于 'define')
    const actualLlvmFuncSignature = `${returnLlvmType} (${closureFuncLlvmParams.join(', ')})`;
    const closureFuncName = `@${uniqueFunctionName}`;

    // --- 存储当前状态以在生成内部函数后恢复 ---
    const savedCurrentFunction = generator.currentFunction;
    const savedCurrentScope = generator.currentScope;
    const savedSretPointer = generator.sretPointer;
    // --- 结束保存状态 ---

    // 步骤 4: 发出实际的 LLVM 函数定义 (现在) 到一个提升的缓冲区
    const savedBuilder = generator.builder;
    const savedIndent = generator.indentLevel;
    generator.builder = [];
    generator.indentLevel = 0;

    // 暂时设置上下文以生成内部函数
    generator.currentFunction = new FunctionDeclaration(
        new Token(TokenType.IDENTIFIER, uniqueFunctionName, uniqueFunctionName, 0, 0),
        expr.parameters,
        expr.returnType,
        expr.body,
        false, // 未导出
        new Token(TokenType.PRIVATE, 'private', 'private', 0, 0), // 私有链接
        capturedVariables // 在这里传递捕获的变量
    );

    generator.sretPointer = null; // 为此闭包函数重置 sret

    // 为闭包的主体创建新的作用域
    generator.emit(`define internal ${returnLlvmType} ${closureFuncName}(${closureFuncLlvmParams.map((t, i) => `${t} %arg${i}`).join(', ')}) {`, false);
    generator.indentLevel++;
    generator.emit('entry:', false);
    generator.enterScope(); // 闭包参数和局部变量的新作用域

    // 如果环境指针存在，则存储环境指针
    let envParamName: string | null = null;
    if (envStructPtrType) {
        envParamName = '%arg0'; // 第一个参数是 (通用) 环境指针 (i8*)
        const castedEnv = generator.llvmHelper.getNewTempVar();
        generator.emit(`${castedEnv} = bitcast i8* ${envParamName} to ${envStructPtrType}`);
        // 在当前作用域中定义它以供查找，以便 visitIdentifierExpr 可以找到它
        generator.currentScope.define('__env_ptr', {
            llvmType: envStructPtrType,
            ptr: castedEnv,
            isPointer: true,
            definedInScopeDepth: generator.currentScope.depth
        });
    } else {
        // 即使没有捕获的变量，我们仍然有一个 env 参数 (可以为 null)
        envParamName = '%arg0';
    }

    // 将传入参数存储到闭包新作用域中的 alloca
    let argIdxOffset = envStructPtrType ? 1 : 0;
    expr.parameters.forEach((p, index) => {
        const paramName = p.name.lexeme;
        let paramType = generator.llvmHelper.getLLVMType(p.type);
        // 对用户定义结构体应用引用传递
        if (paramType.startsWith('%struct.') && paramType !== LangItems.string.structName) {
            paramType = `${paramType}*`;
        }

        const paramAlloca = `%p.${paramName}`;
        const incomingArgName = `%arg${index + argIdxOffset}`;

        generator.emit(`${paramAlloca} = alloca ${paramType}, align ${generator.llvmHelper.getAlign(paramType)}`);
        generator.emit(`store ${paramType} ${incomingArgName}, ${paramType}* ${paramAlloca}, align ${generator.llvmHelper.getAlign(paramType)}`);

        generator.currentScope.define(paramName, {
            llvmType: paramType,
            ptr: paramAlloca,
            isPointer: paramType.endsWith('*'),
            definedInScopeDepth: generator.currentScope.depth
        });
    });

    // --- 处理闭包主体中捕获变量的核心逻辑 ---
    // 这通过修改 visitIdentifierExpr 来检查 '__env_ptr' (如果变量被捕获) 来处理。

    // 发出函数字面量的主体
    expr.body.accept(generator);

    // 确保函数始终返回 (即使 void 函数也需要 `ret void`)
    const lastLine = generator.builder[generator.builder.length - 1];
    if (lastLine !== undefined && !lastLine.trim().startsWith('ret ') && !lastLine.trim().startsWith('br ')) {
        if (returnLlvmType === 'void') {
            generator.emit(`ret void`);
        } else {
            generator.emit(`unreachable`); // 通常应由语义分析捕获
        }
    }

    generator.exitScope(); // 退出闭包的主体作用域
    generator.indentLevel--;
    generator.emit('}', false); // 实际 LLVM 函数定义的结束
    generator.emit('', false);

    // 捕获并提升生成的函数定义，然后恢复状态
    generator.hoistFunctionDefinition(generator.builder);
    generator.builder = savedBuilder;
    generator.indentLevel = savedIndent;
    generator.currentFunction = savedCurrentFunction;
    generator.currentScope = savedCurrentScope;
    generator.sretPointer = savedSretPointer;
    // --- 结束恢复状态 ---

    // 步骤 5: 构建闭包对象 (函数指针 + 环境指针)
    // 此 `FunctionLiteralExpr` 本身成为一个评估为闭包对象的表达式。

    // 在堆上分配环境结构体并存储捕获的变量
    if (capturedVariables.length > 0) {
        // 计算环境结构体的大小
        const totalEnvSize = capturedVariables.reduce((sum, cv) => sum + generator.llvmHelper.sizeOf(cv.llvmType + '*'), 0);

        const envRawPtr = generator.llvmHelper.getNewTempVar();
        envInstancePtr = generator.llvmHelper.getNewTempVar();
        generator.emit(`${envRawPtr} = call i8* @yulang_malloc(i64 ${totalEnvSize})`); // 在堆上分配环境
        generator.emit(`${envInstancePtr} = bitcast i8* ${envRawPtr} to ${envStructPtrType}`); // 转换为类型化指针

        capturedVariables.forEach((cv, index) => {
            // 获取捕获变量的地址 (即 cv.ptr)
            // 将此地址 (指向变量的指针) 存储到环境结构体的字段中
            const envFieldPtr = generator.llvmHelper.getNewTempVar();
            const cvPtrType = `${cv.llvmType}*`; // 指向捕获变量的指针类型
            generator.emit(`${envFieldPtr} = getelementptr inbounds ${envStructType}, ${envStructPtrType} ${envInstancePtr}, i32 0, i32 ${index}`);
            generator.emit(`store ${cvPtrType} ${cv.ptr}, ${cvPtrType}* ${envFieldPtr}, align 8`);
        });
    } else {
        envInstancePtr = 'null';
    }

    // 在栈上创建闭包对象 ({ func_ptr, env_ptr } 的结构体)
    // 此闭包对象的类型为 `{ actualFuncType*, i8* env_ptr }`

    // 始终构建闭包对象 { func_ptr, i8* env_ptr }
    const closureObjLlvmType = `{ ${actualLlvmFuncSignature}*, i8* }`;
    const closureObjPtr = generator.llvmHelper.getNewTempVar();
    generator.emit(`${closureObjPtr} = alloca ${closureObjLlvmType}, align 8`);

    // 存储函数指针
    const funcPtrField = generator.llvmHelper.getNewTempVar();
    generator.emit(`${funcPtrField} = getelementptr inbounds ${closureObjLlvmType}, ${closureObjLlvmType}* ${closureObjPtr}, i32 0, i32 0`);
    generator.emit(`store ${actualLlvmFuncSignature}* ${closureFuncName}, ${actualLlvmFuncSignature}** ${funcPtrField}, align 8`);

    // 存储环境指针 (bitcast 为 i8*)
    const envPtrField = generator.llvmHelper.getNewTempVar();
    generator.emit(`${envPtrField} = getelementptr inbounds ${closureObjLlvmType}, ${closureObjLlvmType}* ${closureObjPtr}, i32 0, i32 1`);
    const envAsI8 = generator.llvmHelper.getNewTempVar();
    const envSource = envStructPtrType ? `${envStructPtrType} ${envInstancePtr}` : `i8* ${envInstancePtr}`;
    if (envStructPtrType && envInstancePtr !== 'null') {
        generator.emit(`${envAsI8} = bitcast ${envSource} to i8*`);
        generator.emit(`store i8* ${envAsI8}, i8** ${envPtrField}, align 8`);
    } else {
        generator.emit(`store i8* ${envInstancePtr}, i8** ${envPtrField}, align 8`);
    }

    return { value: closureObjPtr, type: `${closureObjLlvmType}*` };
}

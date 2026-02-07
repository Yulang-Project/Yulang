// src/generator/irgen/stmt_control_flow.ts

import {
    ExpressionStmt, BlockStmt, IfStmt, WhileStmt, ReturnStmt, MacroBlockStmt
} from '../../ast.js';
import { IRGenerator } from './ir_generator_base.js';

/**
 * 处理 Expression 语句。
 * @param generator IR 生成器实例。
 * @param stmt ExpressionStmt 语句。
 */
export function visitExpressionStmt(generator: IRGenerator, stmt: ExpressionStmt): void {
    stmt.expression.accept(generator); // 消耗结果
}

/**
 * 处理 Block 语句。
 * @param generator IR 生成器实例。
 * @param stmt BlockStmt 语句。
 */
export function visitBlockStmt(generator: IRGenerator, stmt: BlockStmt): void {
    generator.enterScope();
    stmt.statements.forEach(s => s.accept(generator));
    generator.exitScope();
}

/**
 * 处理 If 语句。
 * @param generator IR 生成器实例。
 * @param stmt IfStmt 语句。
 */
export function visitIfStmt(generator: IRGenerator, stmt: IfStmt): void {
    const condition = stmt.condition.accept(generator);
    if (condition.type !== 'i1') {
        throw new Error('If 条件必须是布尔表达式。');
    }

    const thenLabel = generator.getNewLabel('if.then');
    const elseLabel = generator.getNewLabel('if.else');
    const endLabel = generator.getNewLabel('if.end');

    const finalDest = stmt.elseBranch ? elseLabel : endLabel;
    generator.emit(`br i1 ${condition.value}, label %${thenLabel}, label %${finalDest}`);

    generator.emit(`${thenLabel}:`, false);
    generator.indentLevel++;
    stmt.thenBranch.accept(generator);
    generator.emit(`br label %${endLabel}`);
    generator.indentLevel--;

    if (stmt.elseBranch) {
        generator.emit(`${elseLabel}:`, false);
        generator.indentLevel++;
        stmt.elseBranch.accept(generator);
        generator.emit(`br label %${endLabel}`);
        generator.indentLevel--;
    }

    generator.emit(`${endLabel}:`, false);
}

/**
 * 处理 While 语句。
 * @param generator IR 生成器实例。
 * @param stmt WhileStmt 语句。
 */
export function visitWhileStmt(generator: IRGenerator, stmt: WhileStmt): void {
    const headerLabel = generator.getNewLabel('while.header');
    const bodyLabel = generator.getNewLabel('while.body');
    const endLabel = generator.getNewLabel('while.end');

    generator.emit(`br label %${headerLabel}`);

    generator.emit(`${headerLabel}:`, false);
    generator.indentLevel++;
    const condition = stmt.condition.accept(generator);
    if (condition.type !== 'i1') {
        throw new Error('While 条件必须是布尔表达式。');
    }
    generator.emit(`br i1 ${condition.value}, label %${bodyLabel}, label %${endLabel}`);
    generator.indentLevel--;

    generator.emit(`${bodyLabel}:`, false);
    generator.indentLevel++;
    stmt.body.accept(generator);
    generator.emit(`br label %${headerLabel}`);
    generator.indentLevel--;

    generator.emit(`${endLabel}:`, false);
}

/**
 * 处理 MacroBlock 语句。
 * @param generator IR 生成器实例。
 * @param stmt MacroBlockStmt 语句。
 */
export function visitMacroBlockStmt(generator: IRGenerator, stmt: MacroBlockStmt): void {
    const savedInMacroBlock = generator.inMacroBlock;
    const savedMacroBlockType = generator.macroBlockType;

    generator.inMacroBlock = true;
    generator.macroBlockType = stmt.macroType.type;

    generator.enterScope(); // 宏块创建一个新作用域
    stmt.body.accept(generator); // 为块的主体生成 IR
    generator.exitScope(); // 退出宏块作用域

    generator.inMacroBlock = savedInMacroBlock;
    generator.macroBlockType = savedMacroBlockType;
}

/**
 * 处理 Return 语句。
 * @param generator IR 生成器实例。
 * @param stmt ReturnStmt 语句。
 */
export function visitReturnStmt(generator: IRGenerator, stmt: ReturnStmt): void {
    if (!generator.currentFunction) {
        throw new Error("Return 语句在函数外部。");
    }
    const funcReturnType = generator.llvmHelper.getLLVMType(generator.currentFunction.returnType);

    if (stmt.value) {
        const retVal = stmt.value.accept(generator);

        if (generator.sretPointer) {
            // SRET 约定：将 retVal.value 指向的结构体复制到 sret 指针
            // retVal.value 预期是返回结构体的指针 (例如，%struct.string*)

            const structSize = 16; // 为 %struct.string 大小硬编码 (8 字节用于 ptr，8 字节用于 len)
            const sizeOfStructI64 = `${structSize}`;

            // 将两个指针都转换为 i8* 进行 memcpy
            const destPtr = generator.sretPointer;
            const srcPtr = retVal.value;

            const destI8Ptr = generator.llvmHelper.getNewTempVar();
            const srcI8Ptr = generator.llvmHelper.getNewTempVar();

            // 确定目标指针的 LLVM 类型，这里假设 sretPointer 已经是 ptr 类型
            const sretPtrLlvmType = `ptr`; // 假设 sretPointer 已经是 ptr 类型

            generator.emit(`${destI8Ptr} = bitcast ${sretPtrLlvmType} ${destPtr} to i8*`);
            generator.emit(`${srcI8Ptr} = bitcast ${retVal.type} ${srcPtr} to i8*`);

            const call = generator.builtins.createMemcpy(
                { value: destI8Ptr, type: 'i8*' },
                { value: srcI8Ptr, type: 'i8*' },
                { value: sizeOfStructI64, type: 'i64' }
            );
            generator.emit(call);
            generator.emit(`ret void`);
        } else {
            // 如果返回值类型与函数签名不一致，进行必要的转换
            let retValType = retVal.type;
            let retValValue = retVal.value;

            if (funcReturnType !== retValType) {
                const conv = generator.llvmHelper.getNewTempVar();
                const isRetInt = funcReturnType.startsWith('i') && !funcReturnType.endsWith('*');
                const isValInt = retValType.startsWith('i') && !retValType.endsWith('*');
                const isRetPtr = funcReturnType.endsWith('*');
                const isValPtr = retValType.endsWith('*');

                if (isRetInt && isValInt) {
                    const retBits = parseInt(funcReturnType.slice(1), 10);
                    const valBits = parseInt(retValType.slice(1), 10);
                    if (valBits < retBits) {
                        generator.emit(`${conv} = sext ${retValType} ${retValValue} to ${funcReturnType}`);
                    } else if (valBits > retBits) {
                        generator.emit(`${conv} = trunc ${retValType} ${retValValue} to ${funcReturnType}`);
                    } else {
                        generator.emit(`${conv} = bitcast ${retValType} ${retValValue} to ${funcReturnType}`);
                    }
                } else if (isRetPtr && isValPtr) {
                    generator.emit(`${conv} = bitcast ${retValType} ${retValValue} to ${funcReturnType}`);
                } else if (isRetPtr && isValInt) {
                    generator.emit(`${conv} = inttoptr ${retValType} ${retValValue} to ${funcReturnType}`);
                } else if (isRetInt && isValPtr) {
                    generator.emit(`${conv} = ptrtoint ${retValType} ${retValValue} to ${funcReturnType}`);
                } else {
                    generator.emit(`${conv} = bitcast ${retValType} ${retValValue} to ${funcReturnType}`);
                }
                retValType = funcReturnType;
                retValValue = conv;
            }

            generator.emit(`ret ${retValType} ${retValValue}`);
        }
    } else {
        generator.emit(`ret void`);
    }
}

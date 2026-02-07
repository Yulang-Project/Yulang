// src/generator/irgen/expr_simple.ts

import {
    LiteralExpr, BinaryExpr, UnaryExpr, GroupingExpr
} from '../../ast.js';
import { TokenType } from '../../token.js';
import { LangItems } from '../lang_items.js';
import { IRGenerator } from './ir_generator_base.js'; // 注意：这里是 { IRGenerator } 而不是 type { IRGenerator }
import * as irgen_utils from './ir_generator_utils.js';
import type { IRValue } from './types_scopes.js';

/**
 * 处理 Literal 表达式。
 * @param generator IR 生成器实例。
 * @param expr LiteralExpr 表达式。
 * @returns 表达式的 IRValue。
 */
export function visitLiteralExpr(generator: IRGenerator, expr: LiteralExpr): IRValue {
    if (typeof expr.value === 'number') {
        if (Number.isInteger(expr.value)) return { value: `${expr.value}`, type: 'i64' }; // 默认整数推断为 i64
        return { value: `${expr.value}`, type: 'f64' };
    }
    if (typeof expr.value === 'string') {
        const globalString = generator.llvmHelper.createGlobalString(expr.value);
        return { value: globalString.stringStructGlobalName, type: `${LangItems.string.structName}*` };
    }
    if (typeof expr.value === 'boolean') {
        return { value: expr.value ? '1' : '0', type: 'i1' };
    }
    return { value: 'null', type: 'void' };
}

/**
 * 处理 Binary 表达式。
 * @param generator IR 生成器实例。
 * @param expr BinaryExpr 表达式。
 * @returns 表达式的 IRValue。
 */
export function visitBinaryExpr(generator: IRGenerator, expr: BinaryExpr): IRValue {
    const left = expr.left.accept(generator) as IRValue;
    const right = expr.right.accept(generator) as IRValue;
    const resultVar = generator.llvmHelper.getNewTempVar();

    switch (expr.operator.type) {
        case TokenType.PLUS:
            // 内置字符串拼接
            {
                const leftStr = irgen_utils.ensureStringPointer(generator, left);
                const rightStr = irgen_utils.ensureStringPointer(generator, right);
                if (leftStr && rightStr) {
                    return irgen_utils.concatStrings(generator, leftStr, rightStr);
                }
            }

            // 指针加法 (ptr + int)
            if (left.type.endsWith('*') && right.type.startsWith('i')) {
                const baseType = left.type.slice(0, -1); // 移除 '*' 获取基础类型
                const rightI64 = irgen_utils.ensureI64(generator, right); // ensureI64 返回 string 值
                generator.emit(`${resultVar} = getelementptr inbounds ${baseType}, ${left.type} ${left.value}, i64 ${rightI64.value}`); // 注意这里，rightI64 应该直接是 string
                return { value: resultVar, type: left.type }; // 结果类型仍然是原始指针类型
            }

            // 数字加法 (如果不是字符串也不是指针，那就是数字)
            generator.emit(`${resultVar} = add nsw ${left.type} ${left.value}, ${right.value}`);
            return { value: resultVar, type: left.type };

        case TokenType.MINUS:
            generator.emit(`${resultVar} = sub nsw ${left.type} ${left.value}, ${right.value}`);
            return { value: resultVar, type: left.type };
        case TokenType.STAR:
            generator.emit(`${resultVar} = mul nsw ${left.type} ${left.value}, ${right.value}`);
            return { value: resultVar, type: left.type };
        case TokenType.SLASH:
            generator.emit(`${resultVar} = sdiv ${left.type} ${left.value}, ${right.value}`);
            return { value: resultVar, type: left.type };
        case TokenType.PERCENT: // Added PERCENT for modulo
            generator.emit(`${resultVar} = srem ${left.type} ${left.value}, ${right.value}`);
            return { value: resultVar, type: left.type };
        case TokenType.AMPERSAND: // Added AMPERSAND for bitwise AND
            generator.emit(`${resultVar} = and ${left.type} ${left.value}, ${right.value}`);
            return { value: resultVar, type: left.type };
        case TokenType.PIPE: // Added PIPE for bitwise OR
            generator.emit(`${resultVar} = or ${left.type} ${left.value}, ${right.value}`);
            return { value: resultVar, type: left.type };
        case TokenType.CARET: // Added CARET for bitwise XOR
            generator.emit(`${resultVar} = xor ${left.type} ${left.value}, 1`);
            return { value: resultVar, type: 'i1' };
        case TokenType.LT_LT: // Added LT_LT for left shift
            generator.emit(`${resultVar} = shl ${left.type} ${left.value}, ${right.value}`);
            return { value: resultVar, type: left.type };
        case TokenType.GT_GT: // Added GT_GT for right shift (arithmetic right shift for signed)
            generator.emit(`${resultVar} = ashr ${left.type} ${left.value}, ${right.value}`);
            return { value: resultVar, type: left.type };

        // 比较运算符
        case TokenType.EQ_EQ:
            generator.emit(`${resultVar} = icmp eq ${left.type} ${left.value}, ${right.value}`);
            return { value: resultVar, type: 'i1' };
        case TokenType.BANG_EQ:
            generator.emit(`${resultVar} = icmp ne ${left.type} ${left.value}, ${right.value}`);
            return { value: resultVar, type: 'i1' };
        case TokenType.GT:
            generator.emit(`${resultVar} = icmp sgt ${left.type} ${left.value}, ${right.value}`);
            return { value: resultVar, type: 'i1' };
        case TokenType.GT_EQ:
            generator.emit(`${resultVar} = icmp sge ${left.type} ${left.value}, ${right.value}`);
            return { value: resultVar, type: 'i1' };
        case TokenType.LT:
            generator.emit(`${resultVar} = icmp slt ${left.type} ${left.value}, ${right.value}`);
            return { value: resultVar, type: 'i1' };
        case TokenType.LT_EQ:
            generator.emit(`${resultVar} = icmp sle ${left.type} ${left.value}, ${right.value}`);
            return { value: resultVar, type: 'i1' };

        default:
            throw new Error(`不支持的二元运算符: ${expr.operator.lexeme}`);
    }
}

/**
 * 处理 Unary 表达式。
 * @param generator IR 生成器实例。
 * @param expr UnaryExpr 表达式。
 * @returns 表达式的 IRValue。
 */
export function visitUnaryExpr(generator: IRGenerator, expr: UnaryExpr): IRValue {
    const right = expr.right.accept(generator) as IRValue;
    const resultVar = generator.llvmHelper.getNewTempVar();

    switch (expr.operator.type) {
        case TokenType.MINUS: // 取反
            generator.emit(`${resultVar} = sub nsw ${right.type} 0, ${right.value}`);
            return { value: resultVar, type: right.type };
        case TokenType.BANG: // 逻辑非
            generator.emit(`${resultVar} = xor i1 ${right.value}, 1`);
            return { value: resultVar, type: 'i1' };
        default:
            throw new Error(`不支持的一元运算符: ${expr.operator.lexeme}`);
    }
}

/**
 * 处理 Grouping 表达式。
 * @param generator IR 生成器实例。
 * @param expr GroupingExpr 表达式。
 * @returns 表达式的 IRValue。
 */
export function visitGroupingExpr(generator: IRGenerator, expr: GroupingExpr): IRValue {
    return expr.expression.accept(generator);
}
// src/generator/irgen/expr_objects.ts

import {
    IdentifierExpr, GetExpr, NewExpr, DeleteExpr, ObjectLiteralExpr, ThisExpr, AsExpr
} from '../../ast.js';
import { LangItems } from '../lang_items.js';
import { IRGenerator } from './ir_generator_base.js';
import * as irgen_utils from './ir_generator_utils.js';
import type { IRValue, MemberEntry } from './types_scopes.js';
import { TokenType, Token } from '../../token.js'; // Needed for FunctionDeclaration token

/**
 * 处理 New 表达式。
 * @param generator IR 生成器实例。
 * @param expr NewExpr 表达式。
 * @returns 表达式的 IRValue。
 */
export function visitNewExpr(generator: IRGenerator, expr: NewExpr): IRValue {
    // 从 callee (Identifier 或带有模块前缀的 GetExpr) 确定类名
    let className: string | null = null;
    if (expr.callee instanceof IdentifierExpr) {
        className = expr.callee.name.lexeme;
    } else if (expr.callee instanceof GetExpr) {
        className = expr.callee.name.lexeme;
    }
    if (!className) {
        throw new Error("new 表达式需要一个类标识符");
    }

    const classEntry = generator.classDefinitions.get(className);
    if (!classEntry) {
        throw new Error(`new 的类未定义: ${className}`);
    }

    // 通过 GEP null,1 技巧计算大小
    const sizePtr = generator.llvmHelper.getNewTempVar();
    generator.emit(`${sizePtr} = getelementptr inbounds ${classEntry.llvmType}, ${classEntry.llvmType}* null, i32 1`);
    const sizeInt = generator.llvmHelper.getNewTempVar();
    generator.emit(`${sizeInt} = ptrtoint ${classEntry.llvmType}* ${sizePtr} to i64`);

    // 堆分配 (与 _builtin_alloc 相同)
    irgen_utils.ensureHeapGlobals(generator);
    const initFlag = generator.llvmHelper.getNewTempVar();
    generator.emit(`${initFlag} = load i1, i1* @__heap_initialized, align 1`);
    const initEnd = generator.getNewLabel('heap.init.end.new');
    const initDo = generator.getNewLabel('heap.init.do.new');
    generator.emit(`br i1 ${initFlag}, label %${initEnd}, label %${initDo}`);

    generator.emit(`${initDo}:`, false);
    generator.indentLevel++;
    const curBrk = generator.llvmHelper.getNewTempVar();
    generator.emit(`${curBrk} = call i64 @__syscall6(i64 12, i64 0, i64 0, i64 0, i64 0, i64 0, i64 0)`);
    const curBrkPtr = generator.llvmHelper.getNewTempVar();
    generator.emit(`${curBrkPtr} = inttoptr i64 ${curBrk} to i8*`);
    generator.emit(`store i8* ${curBrkPtr}, i8** @__heap_brk, align 8`);
    generator.emit(`store i1 true, i1* @__heap_initialized, align 1`);
    generator.emit(`br label %${initEnd}`);
    generator.indentLevel--;

    generator.emit(`${initEnd}:`, false);
    const oldBrk = generator.llvmHelper.getNewTempVar();
    generator.emit(`${oldBrk} = load i8*, i8** @__heap_brk, align 8`);
    const nextBrk = generator.llvmHelper.getNewTempVar();
    generator.emit(`${nextBrk} = getelementptr inbounds i8, i8* ${oldBrk}, i64 ${sizeInt}`);
    const nextBrkInt = generator.llvmHelper.getNewTempVar();
    generator.emit(`${nextBrkInt} = ptrtoint i8* ${nextBrk} to i64`);
    const brkRes = generator.llvmHelper.getNewTempVar();
    generator.emit(`${brkRes} = call i64 @__syscall6(i64 12, i64 ${nextBrkInt}, i64 0, i64 0, i64 0, i64 0, i64 0)`);
    const brkPtr = generator.llvmHelper.getNewTempVar();
    generator.emit(`${brkPtr} = inttoptr i64 ${brkRes} to i8*`);
    generator.emit(`store i8* ${brkPtr}, i8** @__heap_brk, align 8`);

    // 指向对象的类型化指针
    const objPtr = generator.llvmHelper.getNewTempVar();
    generator.emit(`${objPtr} = bitcast i8* ${oldBrk} to ${classEntry.llvmType}*`);

    // 如果存在，则调用构造函数
    const ctor = classEntry.methods.get('constructor');
    if (ctor) {
        const returnType = generator.llvmHelper.getLLVMType(ctor.returnType);
        const paramTypes = ctor.parameters.map(p => generator.llvmHelper.getLLVMType(p.type));
        const funcName = `_cls_${className}_constructor`;

        const argValues = expr.args.map(a => a.accept(generator) as IRValue);

        const callArgs: string[] = [];
        // this
        callArgs.push(`${classEntry.llvmType}* ${objPtr}`);
        // 带有基本类型转换的用户参数 (仅整数加宽和指针 bitcast)
        argValues.forEach((arg, idx) => {
            const expected = paramTypes[idx] || arg.type;
            let val = arg.value;
            let typ = arg.type;
            if (expected !== typ) {
                if (expected.endsWith('*') && typ.endsWith('*')) {
                    const casted = generator.llvmHelper.getNewTempVar();
                    generator.emit(`${casted} = bitcast ${typ} ${val} to ${expected}`);
                    val = casted; typ = expected;
                } else if (expected === 'i64' && typ === 'i32') {
                    const sext = generator.llvmHelper.getNewTempVar();
                    generator.emit(`${sext} = sext i32 ${val} to i64`);
                    val = sext; typ = 'i64';
                }
            }
            callArgs.push(`${expected || typ} ${val}`);
        });

        if (returnType.startsWith('%struct.') && !returnType.endsWith('*')) {
            const retTmp = generator.llvmHelper.getNewTempVar();
            generator.emit(`${retTmp} = alloca ${returnType}, align ${generator.llvmHelper.getAlign(returnType)}`);
            callArgs.unshift(`${returnType}* ${retTmp}`);
            generator.emit(`call void @_cls_${className}_constructor(${callArgs.join(', ')})`);
        } else {
            generator.emit(`call ${returnType} @_cls_${className}_constructor(${callArgs.join(', ')})`);
        }
    }

    return { value: objPtr, type: `${classEntry.llvmType}*` };
}

/**
 * 处理 Delete 表达式。
 * @param generator IR 生成器实例。
 * @param expr DeleteExpr 表达式。
 * @returns 表达式的 IRValue。
 */
export function visitDeleteExpr(generator: IRGenerator, expr: DeleteExpr): IRValue {
    const target = expr.target.accept(generator);
    // 仅释放通过 brk 增量分配器分配的堆对象。
    if (target.type.endsWith('*')) {
        const ptrAsI8 = generator.llvmHelper.getNewTempVar();
        generator.emit(`${ptrAsI8} = bitcast ${target.type} ${target.value} to i8*`);
        // 简单的释放：如果这是顶部分配，则重置堆中断
        const curBrk = generator.llvmHelper.getNewTempVar();
        generator.emit(`${curBrk} = load i8*, i8** @__heap_brk, align 8`);
        const cmpTop = generator.llvmHelper.getNewTempVar();
        generator.emit(`${cmpTop} = icmp eq i8* ${ptrAsI8}, ${curBrk}`);
        const endLbl = generator.getNewLabel('free.end');
        const doLbl = generator.getNewLabel('free.do');
        generator.emit(`br i1 ${cmpTop}, label %${doLbl}, label %${endLbl}`);
        generator.emit(`${doLbl}:`, false);
        generator.indentLevel++;
        const ptrInt = generator.llvmHelper.getNewTempVar();
        generator.emit(`${ptrInt} = ptrtoint i8* ${ptrAsI8} to i64`);
        generator.emit(`call i64 @__syscall6(i64 12, i64 0, i64 0, i64 0, i64 0, i64 0, i64 0)`);
        generator.emit(`store i8* ${ptrAsI8}, i8** @__heap_brk, align 8`);
        generator.indentLevel--;
        generator.emit(`br label %${endLbl}`);
        generator.emit(`${endLbl}:`, false);
    }
    return { value: '', type: 'void' };
}

/**
 * 处理 This 表达式。
 * @param generator IR 生成器实例。
 * @param expr ThisExpr 表达式。
 * @returns 表达式的 IRValue。
 */
export function visitThisExpr(generator: IRGenerator, expr: ThisExpr): IRValue {
    // 'this' 指的是当前实例 (自指针)
    // 在类方法中，'this' 通常是第一个隐式参数。
    // 我们需要从当前作用域中查找它。
    const entry = generator.currentScope.find("this");
    if (!entry) {
        throw new Error("不能在类方法之外使用 'this'。");
    }
    const tempVar = generator.llvmHelper.getNewTempVar();
    generator.emit(`${tempVar} = load ${entry.llvmType}, ${entry.llvmType}* ${entry.ptr}, align ${generator.llvmHelper.getAlign(entry.llvmType)}`);
    return { value: tempVar, type: entry.llvmType };
}

/**
 * 处理 As 表达式。
 * @param generator IR 生成器实例。
 * @param expr AsExpr 表达式。
 * @returns 表达式的 IRValue。
 */
export function visitAsExpr(generator: IRGenerator, expr: AsExpr): IRValue {
    const value = expr.expression.accept(generator);
    const targetLlvmType = generator.llvmHelper.getLLVMType(expr.type); // 获取目标 LLVM 类型

    const isSrcPtr = value.type.endsWith('*');
    const isDstPtr = targetLlvmType.endsWith('*');
    const dstIsIntCast = targetLlvmType.startsWith('i') && !isDstPtr;
    const dstIsFloatCast = targetLlvmType.startsWith('f');

    // 新情况: 将指针从 `objof` 解引用为值。
    // 例如，(objof(addr) as int) -> 值从 `i8*` 到 `i32`
    if (isSrcPtr && dstIsIntCast) {
        const resultVar = generator.llvmHelper.getNewTempVar();
        generator.emit(`${resultVar} = ptrtoint ${value.type} ${value.value} to ${targetLlvmType}`);
        return { value: resultVar, type: targetLlvmType };
    }

    if (isSrcPtr && !isDstPtr) {
        const targetPtrType = targetLlvmType + "*";

        // 1. 将通用指针 (可能来自 objof 的 i8*) 转换为正确的类型化指针。
        const castedPtr = generator.llvmHelper.getNewTempVar();
        generator.emit(`${castedPtr} = bitcast ${value.type} ${value.value} to ${targetPtrType}`);

        // 2. 从类型化指针加载值。
        const loadedValue = generator.llvmHelper.getNewTempVar();
        generator.emit(`${loadedValue} = load ${targetLlvmType}, ${targetPtrType} ${castedPtr}, align ${generator.llvmHelper.getAlign(targetLlvmType)}`);

        return { value: loadedValue, type: targetLlvmType };
    }

    if (value.type === targetLlvmType) {
        return value; // 类型相同，无需转换
    }

    const src = value.type;
    const dst = targetLlvmType;
    const resultVar = generator.llvmHelper.getNewTempVar();

    const isSrcInt = src.startsWith('i');
    const isDstInt = dst.startsWith('i');
    // isSrcPtr 和 isDstPtr 已经定义在上面

    if (isSrcInt && isDstInt) {
        const srcBits = parseInt(src.slice(1), 10);
        const dstBits = parseInt(dst.slice(1), 10);
        if (dstBits > srcBits) {
            generator.emit(`${resultVar} = sext ${src} ${value.value} to ${dst}`);
        } else if (dstBits < srcBits) {
            generator.emit(`${resultVar} = trunc ${src} ${value.value} to ${dst}`);
        } else {
            generator.emit(`${resultVar} = bitcast ${src} ${value.value} to ${dst}`);
        }
        return { value: resultVar, type: dst };
    }

    if (isSrcPtr && isDstPtr) {
        generator.emit(`${resultVar} = bitcast ${src} ${value.value} to ${dst}`);
        return { value: resultVar, type: dst };
    }

    if (isSrcPtr && isDstInt) {
        generator.emit(`${resultVar} = ptrtoint ${src} ${value.value} to ${dst}`);
        return { value: resultVar, type: dst };
    }

    if (isSrcInt && isDstPtr) {
        generator.emit(`${resultVar} = inttoptr ${src} ${value.value} to ${dst}`);
        return { value: resultVar, type: dst };
    }

    // 备用
    generator.emit(`${resultVar} = bitcast ${src} ${value.value} to ${dst}`);
    return { value: resultVar, type: dst };
}

/**
 * 处理 ObjectLiteral 表达式。
 * @param generator IR 生成器实例。
 * @param expr ObjectLiteralExpr 表达式。
 * @returns 表达式的 IRValue。
 */
export function visitObjectLiteralExpr(generator: IRGenerator, expr: ObjectLiteralExpr): IRValue {
    // 如果存在预期的结构体类型 (例如，来自 `let a: Point = { ... }`)，则具象化该结构体。
    if (generator.objectLiteralExpectedStructType) {
        const structType = generator.objectLiteralExpectedStructType;
        const className = structType.startsWith('%struct.') ? structType.slice('%struct.'.length) : structType;
        const classEntry = generator.classDefinitions.get(className);
        if (!classEntry) {
            throw new Error(`对象字面量未找到结构体类型 '${structType}'。`);
        }

        // 零初始化目标结构体，然后填充提供的字段。
        const structPtr = generator.llvmHelper.getNewTempVar();
        generator.emit(`${structPtr} = alloca ${structType}, align ${generator.llvmHelper.getAlign(structType)}`);
        generator.emit(`store ${structType} zeroinitializer, ${structType}* ${structPtr}, align ${generator.llvmHelper.getAlign(structType)}`);

        for (const [keyToken, valueExpr] of expr.properties.entries()) {
            const member = classEntry.members.get(keyToken.lexeme);
            if (!member) {
                throw new Error(`结构体字面量 '${structType}' 中未知字段 '${keyToken.lexeme}'。`);
            }
            const value = valueExpr.accept(generator) as IRValue;
            let toStore = value;
            if (value.type === `${member.llvmType}*` && member.llvmType.startsWith('%struct.') && !member.llvmType.endsWith('*')) {
                const loaded = generator.llvmHelper.getNewTempVar();
                generator.emit(`${loaded} = load ${member.llvmType}, ${member.llvmType}* ${value.value}, align ${generator.llvmHelper.getAlign(member.llvmType)}`);
                toStore = { value: loaded, type: member.llvmType };
            } else if (value.type !== member.llvmType) {
                toStore = irgen_utils.coerceValue(generator, value, member.llvmType);
            }
            const fieldPtr = generator.llvmHelper.getNewTempVar();
            generator.emit(`${fieldPtr} = getelementptr inbounds ${classEntry.llvmType}, ${classEntry.llvmType}* ${structPtr}, i32 0, i32 ${member.index}`);
            generator.emit(`store ${member.llvmType} ${toStore.value}, ${member.llvmType}* ${fieldPtr}, align ${generator.llvmHelper.getAlign(member.llvmType)}`);
        }

        return { value: structPtr, type: `${structType}*` };
    }

    // 编译时密封对象字面量 -> 唯一结构体类型
    const literalId = generator.objectLiteralCounter++;
    const structName = `%struct.object_literal_${literalId}`;
    const classKey = `object_literal_${literalId}`;

    const fields: string[] = [];
    const membersMap: Map<string, MemberEntry> = new Map();
    const valueList: IRValue[] = [];

    let index = 0;
    for (const [key, valueExpr] of expr.properties.entries()) {
        const value = valueExpr.accept(generator) as IRValue;
        valueList.push(value);
        fields.push(value.type);
        membersMap.set(key.lexeme, { llvmType: value.type, index });
        index++;
    }

    // 如果尚未完成，则发出结构体定义。提升到模块作用域以保持 IR 有效。
    const structDef = `${structName} = type { ${fields.join(', ')} }`;
    if (!generator.classDefinitions.has(classKey)) {
        generator.emitHoisted(structDef);
        generator.classDefinitions.set(classKey, {
            llvmType: structName,
            members: membersMap,
            methods: new Map()
        });
    }

    const objectPtr = generator.llvmHelper.getNewTempVar();
    generator.emit(`${objectPtr} = alloca ${structName}, align ${generator.llvmHelper.getAlign(structName)}`);

    // 存储每个字段
    index = 0;
    for (const value of valueList) {
        const fieldPtr = generator.llvmHelper.getNewTempVar();
        generator.emit(`${fieldPtr} = getelementptr inbounds ${structName}, ${structName}* ${objectPtr}, i32 0, i32 ${index}`);
        generator.emit(`store ${value.type} ${value.value}, ${value.type}* ${fieldPtr}, align ${generator.llvmHelper.getAlign(value.type)}`);
        index++;
    }

    return { value: objectPtr, type: `${structName}*` };
}
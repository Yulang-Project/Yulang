// src/generator/irgen/ir_generator_utils.ts

import * as path from 'path';
import * as process from 'process';

import { LLVMIRHelper } from '../llvm_ir_helpers.js';
import { BuiltinFunctions } from '../builtins.js';
import { LangItems } from '../lang_items.js';
import type { IPlatform } from '../../platform/IPlatform.js';
import type { ImportStmt, StructDeclaration, ClassDeclaration, FunctionDeclaration, DeclareFunction } from '../../ast.js';
import type {
    IRValue,
    MemberEntry,
    ModuleMember
} from './types_scopes.js';
import { IRGenerator } from './ir_generator_base.js';

/**
 * 确保 syscall 声明。
 * @param generator IR 生成器实例。
 */
export function ensureSyscallDecl(generator: IRGenerator): void {
    // legacy no-op; syscall impl emitted in emitLowLevelRuntime
}

/**
 * 确保堆全局变量。
 * @param generator IR 生成器实例。
 */
export function ensureHeapGlobals(generator: IRGenerator): void {
    // No-op; globals emitted once in emitHeapGlobals
}

/**
 * 发出堆全局变量。
 * @param generator IR 生成器实例。
 */
export function emitHeapGlobals(generator: IRGenerator): void {
    if (generator.heapGlobalsEmitted) return;
    generator.heapGlobalsEmitted = true;
    generator.platform.emitGlobalDefinitions(generator);
}

/**
 * 发出低级运行时。
 * @param generator IR 生成器实例。
 */
export function emitLowLevelRuntime(generator: IRGenerator): void {
    if (generator.lowLevelRuntimeEmitted) return;
    generator.lowLevelRuntimeEmitted = true;
    generator.platform.emitLowLevelRuntime(generator);
}

/**
 * 确保 IRValue 为 i64 类型。
 * @param generator IR 生成器实例。
 * @param irValue 要检查的 IRValue。
 * @returns 转换为 i64 的值字符串。
 */
export function ensureI64(generator: IRGenerator, irValue: IRValue): string {
    if (irValue.type === 'i64') return irValue.value;

    const resultVar = generator.llvmHelper.getNewTempVar();

    if (irValue.type === 'i32') {
        generator.emit(`${resultVar} = sext i32 ${irValue.value} to i64`);
        return resultVar;
    }
    if (irValue.type === 'i1') {
        generator.emit(`${resultVar} = zext i1 ${irValue.value} to i64`);
        return resultVar;
    }
    if (irValue.type.endsWith('*')) {
        const ptrSize = generator.platform.getPointerSizeInBits();
        const ptrToIntTemp = generator.llvmHelper.getNewTempVar();
        generator.emit(`${ptrToIntTemp} = ptrtoint ${irValue.type} ${irValue.value} to i${ptrSize}`);

        if (ptrSize === 64) {
            generator.emit(`${resultVar} = add i64 0, ${ptrToIntTemp}`);
            return resultVar;
        } else {
            generator.emit(`${resultVar} = sext i${ptrSize} ${ptrToIntTemp} to i64`);
            return resultVar;
        }
    }

    throw new Error(`无法将类型 ${irValue.type} 转换为 i64。`);
}

/**
 * 发出语言项结构体。
 * @param generator IR 生成器实例。
 */
export function emitLangItemStructs(generator: IRGenerator): void {
    // 字符串结构体
    if (!generator.classDefinitions.has(LangItems.string.className)) {
        generator.emit(`${LangItems.string.structName} = type { i8*, i64 }`, false);
        const members = new Map<string, MemberEntry>([
            [LangItems.string.members.ptr ? 'ptr' : 'ptr', { llvmType: 'i8*', index: LangItems.string.members.ptr.index }],
            [LangItems.string.members.len ? 'len' : 'len', { llvmType: 'i64', index: LangItems.string.members.len.index }],
        ]);
        generator.classDefinitions.set(LangItems.string.className, {
            llvmType: LangItems.string.structName,
            members,
            methods: new Map()
        });
    }

    // 对象基础结构体（空，用于内置对象）
    if (!generator.classDefinitions.has(LangItems.object.typeName)) {
        generator.emit(`${LangItems.object.structName} = type {}`, false);
        generator.classDefinitions.set(LangItems.object.typeName, {
            llvmType: LangItems.object.structName,
            members: new Map(),
            methods: new Map()
        });
    }
}



/**
 * 拼接字符串。
 * @param generator IR 生成器实例。
 * @param left 左操作数。
 * @param right 右操作数。
 * @returns 拼接结果的 IRValue。
 */
export function concatStrings(generator: IRGenerator, left: IRValue, right: IRValue): IRValue {
    const leftLenPtr = generator.llvmHelper.getNewTempVar();
    const leftLen = generator.llvmHelper.getNewTempVar();
    generator.emit(`${leftLenPtr} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${left.value}, i32 0, i32 ${LangItems.string.members.len.index}`);
    generator.emit(`${leftLen} = load i64, i64* ${leftLenPtr}, align 8`);

    const rightLenPtr = generator.llvmHelper.getNewTempVar();
    const rightLen = generator.llvmHelper.getNewTempVar();
    generator.emit(`${rightLenPtr} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${right.value}, i32 0, i32 ${LangItems.string.members.len.index}`);
    generator.emit(`${rightLen} = load i64, i64* ${rightLenPtr}, align 8`);

    const totalLen = generator.llvmHelper.getNewTempVar();
    generator.emit(`${totalLen} = add i64 ${leftLen}, ${rightLen}`);

    const totalLenWithNull = generator.llvmHelper.getNewTempVar();
    generator.emit(`${totalLenWithNull} = add i64 ${totalLen}, 1`);
    const sizeToAlloc: IRValue = { value: totalLenWithNull, type: 'i64' };

    const allocResult = generator.platform.emitMemoryAllocate(generator, sizeToAlloc);
    const destPtr = allocResult.value;

    const leftDataPtrPtr = generator.llvmHelper.getNewTempVar();
    const leftDataPtr = generator.llvmHelper.getNewTempVar();
    generator.emit(`${leftDataPtrPtr} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${left.value}, i32 0, i32 ${LangItems.string.members.ptr.index}`);
    generator.emit(`${leftDataPtr} = load i8*, i8** ${leftDataPtrPtr}, align 8`);
    const copyLeft = generator.builtins.createMemcpy(
        { value: destPtr, type: 'i8*' },
        { value: leftDataPtr, type: 'i8*' },
        { value: leftLen, type: 'i64' }
    );
    generator.emit(copyLeft);

    const destRight = generator.llvmHelper.getNewTempVar();
    generator.emit(`${destRight} = getelementptr inbounds i8, i8* ${destPtr}, i64 ${leftLen}`);
    const rightDataPtrPtr = generator.llvmHelper.getNewTempVar();
    const rightDataPtr = generator.llvmHelper.getNewTempVar();
    generator.emit(`${rightDataPtrPtr} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${right.value}, i32 0, i32 ${LangItems.string.members.ptr.index}`);
    generator.emit(`${rightDataPtr} = load i8*, i8** ${rightDataPtrPtr}, align 8`);
    const copyRight = generator.builtins.createMemcpy(
        { value: destRight, type: 'i8*' },
        { value: rightDataPtr, type: 'i8*' },
        { value: rightLen, type: 'i64' }
    );
    generator.emit(copyRight);

    const nullTerminatorPtr = generator.llvmHelper.getNewTempVar();
    generator.emit(`${nullTerminatorPtr} = getelementptr inbounds i8, i8* ${destPtr}, i64 ${totalLen}`);
    generator.emit(`store i8 0, i8* ${nullTerminatorPtr}, align 1`);

    const resultStructPtr = generator.llvmHelper.getNewTempVar();
    generator.emit(`${resultStructPtr} = alloca ${LangItems.string.structName}, align 8`);
    const resPtrField = generator.llvmHelper.getNewTempVar();
    generator.emit(`${resPtrField} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${resultStructPtr}, i32 0, i32 ${LangItems.string.members.ptr.index}`);
    generator.emit(`store i8* ${destPtr}, i8** ${resPtrField}, align 8`);
    const resLenField = generator.llvmHelper.getNewTempVar();
    generator.emit(`${resLenField} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${resultStructPtr}, i32 0, i32 ${LangItems.string.members.len.index}`);
    generator.emit(`store i64 ${totalLen}, i64* ${resLenField}, align 8`);

    return { value: resultStructPtr, type: `${LangItems.string.structName}*` };
}

/**
 * 确保代表字符串的 IRValue 是指向字符串结构体的指针。
 * @param generator IR 生成器实例。
 * @param val 要检查的 IRValue。
 * @returns 指向字符串结构体的指针 IRValue，如果无法转换则为 null。
 */
export function ensureStringPointer(generator: IRGenerator, val: IRValue): IRValue | null {
    const structType = LangItems.string.structName;
    const ptrType = `${structType}*`;
    if (val.type === ptrType) return val;
    if (val.type === structType) {
        const tmpPtr = generator.llvmHelper.getNewTempVar();
        generator.emit(`${tmpPtr} = alloca ${structType}, align ${generator.llvmHelper.getAlign(structType)}`);
        generator.emit(`store ${structType} ${val.value}, ${structType}* ${tmpPtr}, align ${generator.llvmHelper.getAlign(structType)}`);
        return { value: tmpPtr, type: ptrType };
    }
    return null;
}

/**
 * 强制转换 IRValue 的类型。
 * @param generator IR 生成器实例。
 * @param value 要转换的 IRValue。
 * @param targetType 目标 LLVM 类型。
 * @returns 转换后的 IRValue。
 */
export function coerceValue(generator: IRGenerator, value: IRValue, targetType: string): IRValue {
    if (value.type === targetType) return value;

    const converted = generator.llvmHelper.getNewTempVar();
    const srcType = value.type;
    const dstType = targetType;

    const isSrcInt = srcType.startsWith('i') && !srcType.endsWith('*');
    const isDstInt = dstType.startsWith('i') && !dstType.endsWith('*');
    const isSrcFloat = srcType.startsWith('f');
    const isDstFloat = dstType.startsWith('f');
    const isSrcPtr = srcType.endsWith('*');
    const isDstPtr = dstType.endsWith('*');

    if (isSrcInt && isDstInt) {
        const srcBits = parseInt(srcType.slice(1), 10);
        const dstBits = parseInt(dstType.slice(1), 10);
        if (dstBits > srcBits) {
            generator.emit(`${converted} = sext i32 ${value.value} to ${dstType}`);
        } else if (dstBits < srcBits) {
            generator.emit(`${converted} = trunc i32 ${value.value} to ${dstType}`);
        } else {
            generator.emit(`${converted} = bitcast ${srcType} ${value.value} to ${dstType}`);
        }
    } else if (isSrcFloat && isDstFloat) {
        const srcBits = parseInt(srcType.slice(1), 10);
        const dstBits = parseInt(dstType.slice(1), 10);
        if (dstBits > srcBits) {
            generator.emit(`${converted} = fpext ${srcType} ${value.value} to ${dstType}`);
        } else if (dstBits < srcBits) {
            generator.emit(`${converted} = fptrunc ${srcType} ${value.value} to ${dstType}`);
        } else {
            generator.emit(`${converted} = bitcast ${srcType} ${value.value} to ${dstType}`);
        }
    } else if (isSrcInt && isDstFloat) {
        generator.emit(`${converted} = sitofp ${srcType} ${value.value} to ${dstType}`);
    } else if (isSrcFloat && isDstInt) {
        generator.emit(`${converted} = fptosi ${srcType} ${value.value} to ${dstType}`);
    } else if (isSrcPtr && isDstPtr) {
        generator.emit(`${converted} = bitcast ${srcType} ${value.value} to ${dstType}`);
    } else if (isSrcInt && isDstPtr) {
        generator.emit(`${converted} = inttoptr ${srcType} ${value.value} to ${dstType}`);
    } else if (isSrcPtr && isDstInt) {
        generator.emit(`${converted} = ptrtoint ${srcType} ${value.value} to ${dstType}`);
    } else {
        generator.emit(`${converted} = bitcast ${srcType} ${value.value} to ${dstType}`);
    }

    return { value: converted, type: targetType };
}

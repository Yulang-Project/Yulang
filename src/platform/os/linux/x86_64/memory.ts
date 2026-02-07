import { IRGenerator, type IRValue } from "../../../../generator/ir_generator.js";
import * as irgen_utils from "../../../../generator/irgen/ir_generator_utils.js";
import { X86_64LinuxPlatform } from "./platform.js";
import { emitSyscall_X86_64 } from "./syscalls.js"; // 内存分配需要系统调用

// 发出 x86-64 Linux 上的内存分配
export function emitMemoryAllocate_X86_64(platform: X86_64LinuxPlatform, generator: IRGenerator, size: IRValue): IRValue {
    // 实现使用 brk 系统调用 (Linux 的 syscall 12)
    // 这是一个简化的 bump allocator。真实的 mmap 会更复杂。
    
    // 确保 size 是 i64
    const sizeI64 = irgen_utils.ensureI64(generator, size);

    // 获取对齐后的 size
    const alignedSize = generator.llvmHelper.getNewTempVar();
    generator.emit(`${alignedSize} = add i64 ${sizeI64}, ${platform.getPointerAlignmentInBytes() - 1}`);
    const alignedSize2 = generator.llvmHelper.getNewTempVar();
    generator.emit(`${alignedSize2} = and i64 ${alignedSize}, ${-platform.getPointerAlignmentInBytes()}`);

    const currentBrk = generator.llvmHelper.getNewTempVar();
    generator.emit(`${currentBrk} = load i8*, i8** @__heap_brk, align 8`);

    const nextBrk = generator.llvmHelper.getNewTempVar();
    generator.emit(`${nextBrk} = getelementptr inbounds i8, i8* ${currentBrk}, i64 ${alignedSize2}`);

    const nextBrkInt = generator.llvmHelper.getNewTempVar();
    generator.emit(`${nextBrkInt} = ptrtoint i8* ${nextBrk} to i64`);
    
    // 执行 brk 系统调用 (12)
    const brkCallNum = { value: '12', type: 'i64' };
    const brkArgs = [{ value: nextBrkInt, type: 'i64' }];
    const brkSyscallResult = emitSyscall_X86_64(platform, generator, brkCallNum, brkArgs); // 调用 syscalls 模块中的函数
    
    const brkPtr = generator.llvmHelper.getNewTempVar();
    generator.emit(`${brkPtr} = inttoptr i64 ${brkSyscallResult.value} to i8*`);
    generator.emit(`store i8* ${brkPtr}, i8** @__heap_brk, align 8`);

    return { value: currentBrk, type: 'i8*' };
}

// 发出 x86-64 Linux 上的内存释放
export function emitMemoryFree_X86_64(platform: X86_64LinuxPlatform, generator: IRGenerator, addr: IRValue, size: IRValue): void {
    // 这是一个非常简化的 free，用于 bump allocator (只回收堆顶部)
    // 确保 addr 是 i8* 且 size 是 i64
    let addrI8Ptr = addr.value;
    if (addr.type !== 'i8*') {
        const tempVar = generator.llvmHelper.getNewTempVar();
        generator.emit(`${tempVar} = bitcast ${addr.type} ${addr.value} to i8*`);
        addrI8Ptr = tempVar;
    }
    const sizeI64 = irgen_utils.ensureI64(generator, size);

    // 获取对齐后的 size
    const alignedSize = generator.llvmHelper.getNewTempVar();
    generator.emit(`${alignedSize} = add i64 ${sizeI64}, ${platform.getPointerAlignmentInBytes() - 1}`);
    const alignedSize2 = generator.llvmHelper.getNewTempVar();
    generator.emit(`${alignedSize2} = and i64 ${alignedSize}, ${-platform.getPointerAlignmentInBytes()}`);


    const currentBrk = generator.llvmHelper.getNewTempVar();
    generator.emit(`${currentBrk} = load i8*, i8** @__heap_brk, align 8`);

    const nextPtr = generator.llvmHelper.getNewTempVar();
    generator.emit(`${nextPtr} = getelementptr inbounds i8, i8* ${addrI8Ptr}, i64 ${alignedSize2}`);

    const isTop = generator.llvmHelper.getNewTempVar();
    generator.emit(`${isTop} = icmp eq i8* ${nextPtr}, ${currentBrk}`);

    const retEnd = generator.getNewLabel('free.end');
    const retTop = generator.getNewLabel('free.top');
    generator.emit(`br i1 ${isTop}, label %${retTop}, label %${retEnd}`);

    generator.emit(`${retTop}:`, false);
    generator.indentLevel++;
    const ptrInt = generator.llvmHelper.getNewTempVar();
    generator.emit(`${ptrInt} = ptrtoint i8* ${addrI8Ptr} to i64`);
    
    // 执行 brk 系统调用 (12)
    const brkCallNum = { value: '12', type: 'i64' };
    const brkArgs = [{ value: ptrInt, type: 'i64' }];
    emitSyscall_X86_64(platform, generator, brkCallNum, brkArgs); // 结果在此处未使用
    
    generator.emit(`store i8* ${addrI8Ptr}, i8** @__heap_brk, align 8`);
    generator.emit(`br label %${retEnd}`);
    generator.indentLevel--;

    generator.emit(`${retEnd}:`, false);
    // 实际的 `ret void` 将由调用者处理。这只是为了内部 free 函数。
}

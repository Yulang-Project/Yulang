import { IRGenerator, type IRValue } from "../../../../generator/ir_generator.js";
import * as irgen_utils from "../../../../generator/irgen/ir_generator_utils.js";
import { ARM64LinuxPlatform } from "./platform.js";
import { emitSyscall_ARM64 } from "./syscalls.js"; // Memory allocation needs syscalls

// Emits memory allocation for ARM64 Linux
export function emitMemoryAllocate_ARM64(platform: ARM64LinuxPlatform, generator: IRGenerator, size: IRValue): IRValue {
    // Implements brk syscall (Linux syscall 12)
    // This is a simplified bump allocator. A real mmap would be more complex.
    
    // Ensure size is i64
    const sizeI64 = irgen_utils.ensureI64(generator, size);

    // Get aligned size
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
    
    // Perform brk syscall (12)
    const brkCallNum = { value: '12', type: 'i64' };
    const brkArgs = [{ value: nextBrkInt, type: 'i64' }];
    const brkSyscallResult = emitSyscall_ARM64(platform, generator, brkCallNum, brkArgs); // Call function from syscalls module
    
    const brkPtr = generator.llvmHelper.getNewTempVar();
    generator.emit(`${brkPtr} = inttoptr i64 ${brkSyscallResult.value} to i8*`);
    generator.emit(`store i8* ${brkPtr}, i8** @__heap_brk, align 8`);

    return { value: currentBrk, type: 'i8*' };
}

// Emits memory deallocation for ARM64 Linux
export function emitMemoryFree_ARM64(platform: ARM64LinuxPlatform, generator: IRGenerator, addr: IRValue, size: IRValue): void {
    // This is a very simplified free for a bump allocator (only reclaims heap top)
    // Ensure addr is i8* and size is i64
    let addrI8Ptr = addr.value;
    if (addr.type !== 'i8*') {
        const tempVar = generator.llvmHelper.getNewTempVar();
        generator.emit(`${tempVar} = bitcast ${addr.type} ${addr.value} to i8*`);
        addrI8Ptr = tempVar;
    }
    const sizeI64 = irgen_utils.ensureI64(generator, size);

    // Get aligned size
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
    
    // Perform brk syscall (12)
    const brkCallNum = { value: '12', type: 'i64' };
    const brkArgs = [{ value: ptrInt, type: 'i64' }];
    emitSyscall_ARM64(platform, generator, brkCallNum, brkArgs); // Result not used here
    
    generator.emit(`store i8* ${addrI8Ptr}, i8** @__heap_brk, align 8`);
    generator.emit(`br label %${retEnd}`);
    generator.indentLevel--;

    generator.emit(`${retEnd}:`, false);
    // Actual `ret void` will be handled by the caller. This is just for internal free functions.
}

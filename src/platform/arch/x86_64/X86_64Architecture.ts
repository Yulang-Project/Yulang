import { IRGenerator, type IRValue } from "../../../generator/ir_generator.js";
import type { IArchitecture } from "../../IArchitecture.js";

export class X86_64Architecture implements IArchitecture {
    getTargetTriple(): string {
        return "x86_64-unknown-linux-gnu"; // Standard Linux x86-64 triple
    }

    getDataLayout(): string {
        return "e-m:e-i64:64-f80:128-n8:16:32:64-S128"; // Common x86-64 Linux datalayout
    }

    emitSyscallInlineASM(generator: IRGenerator, callNum: string, args: string[]): string {
        // Registers for syscall arguments on x86-64 Linux: RDI, RSI, RDX, R10, R8, R9
        // Syscall number goes into RAX
        // Return value comes in RAX

        // Output constraints: "={rax}" for return value
        // Input constraints: "0" for syscall number (RAX), "{rdi}", "{rsi}", etc. for args
        // Clobbers: "~{rcx}", "~{r11}", "~{memory}"

        const argRegisters = ["{rdi}", "{rsi}", "{rdx}", "{r10}", "{r8}", "{r9}"];
        let asmInputs = [callNum, ...args];
        let inputConstraints = ["0"]; // Syscall number in RAX (0th input)

        for (let i = 0; i < args.length && i < argRegisters.length; i++) {
            inputConstraints.push(argRegisters[i] as string);
        }

        // Pad with 0s if fewer than 6 arguments are provided
        while (asmInputs.length < 7) { // 1 for syscall num + 6 for args
            asmInputs.push("i64 0"); // Pad with dummy i64 0
            inputConstraints.push(""); // No specific register constraint for dummy args
        }

        // Construct the full ASM string
        // The first argument to the syscall intrinsic is the syscall number.
        // The subsequent arguments are the actual syscall arguments.
        // We're essentially building: call i64 asm sideeffect "syscall", "={rax},0,{rdi},{rsi},..."(i64 %n, i64 %a1, i64 %a2, ...)
        
        const outputConstraint = "={rax}"; // Return value goes into RAX
        const clobbers = "~{rcx},~{r11},~{memory}"; // Standard syscall clobbers
        
        const constraints = `"${outputConstraint},${inputConstraints.slice(0, 7).join(',')},${clobbers}"`;
        const operands = asmInputs.slice(0, 7).map(arg => `i64 ${arg}`).join(', ');

        // The actual ASM instruction is just "syscall"
        return `call i64 asm sideeffect "syscall", ${constraints}(${operands})`;
    }

    getPointerSizeInBits(): number {
        return 64; // x86-64 is a 64-bit architecture
    }

    getPointerAlignmentInBytes(): number {
        return 8; // Pointers are typically 8-byte aligned on x86-64
    }
}

import { IRGenerator, type IRValue } from "../../../../generator/ir_generator.js";
import * as irgen_utils from "../../../../generator/irgen/ir_generator_utils.js";
import { ARM64LinuxPlatform } from "./platform.js"; // Import the main platform class

// Emits inline assembly for ARM64 Linux syscalls
export function emitSyscallInlineASM_ARM64(generator: IRGenerator, callNum: string, args: string[]): string {
    // ARM64 Linux syscall argument registers: X0 - X7
    // Syscall number goes into X8
    // Return value comes in X0

    // Output constraints: "={x0}" for return value
    // Input constraints: "{x8}" for syscall number (X8), "{x0}", "{x1}", etc. for args
    // Clobbers: "x2", "x3", "x4", "x5", "x6", "x7", "lr" (link register x30) for general syscall safety

    const argRegisters = ["{x0}", "{x1}", "{x2}", "{x3}", "{x4}", "{x5}", "{x6}", "{x7}"];
    let asmInputs = [callNum, ...args];
    let inputConstraints = ["{x8}"]; // Syscall number in X8 (0th input)

    for (let i = 0; i < args.length && i < argRegisters.length; i++) {
        inputConstraints.push(argRegisters[i] as string);
    }
    
    // Pad with 0s if fewer than 8 arguments are provided.
    // The number of operands must match the number of constraints.
    while (asmInputs.length < 9) { // 1 for syscall num + 8 for args (X0-X7)
        asmInputs.push("0"); // Pad with dummy 0
        // We don't add a constraint for dummy inputs, as LLVM doesn't require it for "r" or "i" with 0.
        // However, to be safe and explicit, let's use the 'i' (immediate) constraint for our zero padding.
        inputConstraints.push("i");
    }
    
    const outputConstraint = "={x0}"; // Return value goes into X0
    const clobbers = "~{x2},~{x3},~{x4},~{x5},~{x6},~{x7},~{x30},~{memory}"; // Standard syscall clobbers
    
    // Ensure we only take as many constraints as we have inputs.
    const finalConstraints = inputConstraints.slice(0, asmInputs.length);

    const constraints = `"${outputConstraint},${finalConstraints.join(',')},${clobbers}"`;
    const operands = asmInputs.map(arg => `i64 ${arg}`).join(', ');

    // The actual ASM instruction is just "svc #0"
    return `call i64 asm sideeffect "svc #0", ${constraints}(${operands})`;
}

// Emits a syscall on ARM64 Linux
export function emitSyscall_ARM64(platform: ARM64LinuxPlatform, generator: IRGenerator, callNum: IRValue, args: IRValue[]): IRValue {
    // Prepare arguments for architecture-specific inline ASM
    const syscallArgs: string[] = args.map(a => {
        // Ensure all arguments are i64 for syscalls, converting pointers to i64
        if (a.type.endsWith('*')) {
            const tempVar = generator.llvmHelper.getNewTempVar();
            generator.emit(`${tempVar} = ptrtoint ${a.type} ${a.value} to i64`);
            return tempVar;
        }
        // For now, assume other integer types are coerced to i64 by generator.ensureI64
        // but for the inline asm, we need the actual i64 value.
        return a.value;
    });
    
    // Pad with 0s if fewer than 8 arguments are provided
    while (syscallArgs.length < 8) syscallArgs.push("0");

    const resultVar = generator.llvmHelper.getNewTempVar();
    const callNumVal = irgen_utils.ensureI64(generator, callNum); // Ensure syscall number is i64
    const asmCall = emitSyscallInlineASM_ARM64(generator, callNumVal.value, syscallArgs); // Call local function

    generator.emit(`${resultVar} = ${asmCall}`);
    return { value: resultVar, type: 'i64' };
}

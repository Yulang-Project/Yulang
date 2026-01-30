.section .text
.global _start

_start:
    # --- 关键：栈对齐 ---
    # 内核把 argc 压栈后，rsp 往往是 8 字节对齐
    # 我们必须强制 16 字节对齐，否则 LLVM 内部的某些指令会报 Segment Fault
    andq $-16, %rsp

    # --- 获取 argc 和 argv ---
    # argc 在栈顶
    pop %rdi                    # argc -> RDI (第一个参数)
    mov %rsp, %rsi              # argv 数组的地址 -> RSI (第二个参数)
    
    # --- 逻辑跳转 ---
    call main
    
    # --- 退出处理 ---
    movq %rax, %rdi
    movq $60, %rax       # sys_exit 的编号
    syscall

# ---------------------------------------------------------
# 2. 安全声明（必须放在所有逻辑之外，建议文件最末尾）
# ---------------------------------------------------------
.section .note.GNU-stack,"",@progbits
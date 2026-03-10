.section .text
.global _start
.extern _yulang_startup # 声明外部函数

_start:
    # --- 关键：栈对齐 ---
    # 内核把 argc 压栈后，rsp 往往是 8 字节对齐
    # 我们必须强制 16 字节对齐，否则 LLVM 内部的某些指令会报 Segment Fault
    andq $-16, %rsp

    # --- 获取 argc 和 argv ---
    # argc 在栈顶
    pop %rdi                    # argc -> RDI (第一个参数)
    mov %rsp, %rsi              # argv 数组的地址 -> RSI (第二个参数)
    
    # 栈上紧接着 argv 后面就是 envp，所以需要计算 envp 的地址
    # 遍历 argv 找到 NULL 终止符，其下一个就是 envp 的开始
    # x86-64 System V ABI: rdi=argc, rsi=argv, rdx=envp
    # 先将 rsp 存储到 rdx，然后遍历 rsi (argv) 找到 envp 的起始地址
    mov %rsp, %rdx              # 初始时，rdx指向 argv[0]
    
    # 遍历 argv 找到 NULL 终止符
    .L_find_envp:
        cmpq $0, (%rdx)         # 检查当前 argv 元素是否为 NULL
        je .L_envp_found        # 如果是 NULL，则找到了 envp 的起始位置
        addq $8, %rdx           # 否则，移动到下一个 argv 元素
        jmp .L_find_envp
    
    .L_envp_found:
        addq $8, %rdx           # 跳过 argv 数组末尾的 NULL，rdx 现在指向 envp 的起始位置

    # --- 逻辑跳转 ---
    call _yulang_startup  # 调用 Yulang 的启动函数
    
    # --- 退出处理 ---
    movq %rax, %rdi
    movq $60, %rax       # sys_exit 的编号
    syscall

# ---------------------------------------------------------
# 2. 安全声明（必须放在所有逻辑之外，建议文件最末尾）
# ---------------------------------------------------------
.section .note.GNU-stack,"",@progbits
target triple = "x86_64-unknown-linux-gnu"
target datalayout = "e-m:e-i64:64-f80:128-n8:16:32:64-S128"
%struct.string = type { i8*, i64 }
%struct.object = type {}
declare void @__panic_oob()
%struct.array.i32 = type { i32*, i64, i64 }
define internal void @__heap_init_internal() {
  %t1000 = load i1, i1* @__heap_initialized, align 1
  br i1 %t1000, label %heap.init.done.0, label %heap.init.do.1
heap.init.do.1:
    %t1001 = call i64 asm sideeffect "syscall", "={rax},0,{rdi},{rsi},{rdx},{r10},{r8},{r9},~{rcx},~{r11},~{memory}"(i64 12, i64 0, i64 0, i64 0, i64 0, i64 0, i64 0)
    %t1002 = inttoptr i64 %t1001 to i8*
    store i8* %t1002, i8** @__heap_base, align 8
    store i8* %t1002, i8** @__heap_brk, align 8
    store i1 true, i1* @__heap_initialized, align 1
    br label %heap.init.done.0
heap.init.done.0:
  ret void
}

define internal i8* @yulang_malloc(i64 %size) {
  call void @__heap_init_internal()
  %t1003 = add i64 %size, 7
  %t1004 = and i64 %t1003, -8
  %t1005 = load i8*, i8** @__heap_brk, align 8
  %t1006 = getelementptr inbounds i8, i8* %t1005, i64 %t1004
  %t1007 = ptrtoint i8* %t1006 to i64
  %t1008 = call i64 asm sideeffect "syscall", "={rax},0,{rdi},{rsi},{rdx},{r10},{r8},{r9},~{rcx},~{r11},~{memory}"(i64 12, i64 %t1007, i64 0, i64 0, i64 0, i64 0, i64 0)
  %t1009 = inttoptr i64 %t1008 to i8*
  store i8* %t1009, i8** @__heap_brk, align 8
  ret i8* %t1005
}

define internal void @__memcpy_inline(i8* %dst, i8* %src, i64 %len) {
  %t1010 = alloca i64, align 8
  store i64 0, i64* %t1010, align 8
  br label %memcpy.cmp.2
memcpy.cmp.2:
  %t1011 = load i64, i64* %t1010, align 8
  %t1012 = icmp ult i64 %t1011, %len
  br i1 %t1012, label %memcpy.body.3, label %memcpy.exit.4
memcpy.body.3:
  %t1013 = getelementptr inbounds i8, i8* %dst, i64 %t1011
  %t1014 = getelementptr inbounds i8, i8* %src, i64 %t1011
  %t1015 = load i8, i8* %t1014, align 1
  store i8 %t1015, i8* %t1013, align 1
  %t1016 = add i64 %t1011, 1
  store i64 %t1016, i64* %t1010, align 8
  br label %memcpy.cmp.2
memcpy.exit.4:
  ret void
}

define internal i64 @__syscall6(i64 %n, i64 %a1, i64 %a2, i64 %a3, i64 %a4, i64 %a5, i64 %a6) {
  %t1017 = call i64 asm sideeffect "syscall", "={rax},0,{rdi},{rsi},{rdx},{r10},{r8},{r9},~{rcx},~{r11},~{memory}"(i64 %n, i64 %a1, i64 %a2, i64 %a3, i64 %a4, i64 %a5, i64 %a6)
  ret i64 %t1017
}

%struct.free_node = type { i64, i8* }
@__heap_base = internal global i8* null, align 8
@__heap_brk = internal global i8* null, align 8
@__heap_initialized = internal global i1 false, align 1
@__free_list = internal global %struct.free_node* null, align 8

%struct.File = type { i64 }
define internal void @_cls_File_constructor(%struct.File* %this, %struct.string %path, i64 %flags, i64 %mode) {
entry:
  %this.ptr = alloca %struct.File*, align 8
  store %struct.File* %this, %struct.File** %this.ptr, align 8
  %p.path = alloca %struct.string, align 8
  store %struct.string %path, %struct.string* %p.path, align 8
  %p.flags = alloca i64, align 8
  store i64 %flags, i64* %p.flags, align 8
  %p.mode = alloca i64, align 8
  store i64 %mode, i64* %p.mode, align 8
  %t1018 = load %struct.string, %struct.string* %p.path, align 8
  %t1019 = alloca %struct.string, align 8
  store %struct.string %t1018, %struct.string* %t1019, align 8
  %t1021 = getelementptr inbounds %struct.string, %struct.string* %t1019, i32 0, i32 0
  %t1020 = load i8*, i8** %t1021, align 8
  %path_ptr = alloca i8*, align 8
  store i8* %t1020, i8** %path_ptr, align 8
  %t1022 = load i8*, i8** %path_ptr, align 8
  %t1023 = ptrtoint i8* %t1022 to i64
  %path_addr = alloca i64, align 8
  store i64 %t1023, i64* %path_addr, align 8
  %t1024 = load i64, i64* %path_addr, align 8
  %t1025 = load i64, i64* %p.flags, align 8
  %t1026 = load i64, i64* %p.mode, align 8
  %t1027 = call i64 asm sideeffect "syscall", "={rax},0,{rdi},{rsi},{rdx},{r10},{r8},{r9},~{rcx},~{r11},~{memory}"(i64 2, i64 %t1024, i64 %t1025, i64 %t1026, i64 0, i64 0, i64 0)
  %fd = alloca i64, align 8
  store i64 %t1027, i64* %fd, align 8
  %t1028 = load i64, i64* %fd, align 8
  %t1029 = load %struct.File*, %struct.File** %this.ptr, align 8
  %t1030 = getelementptr inbounds %struct.File, %struct.File* %t1029, i32 0, i32 0
  store i64 %t1028, i64* %t1030, align 8
  ret void
}

define internal void @_cls_File_read(ptr sret(%struct.string) align 8 %agg.result, %struct.File* %this, i64 %max_len) {
entry:
  %this.ptr = alloca %struct.File*, align 8
  store %struct.File* %this, %struct.File** %this.ptr, align 8
  %p.max_len = alloca i64, align 8
  store i64 %max_len, i64* %p.max_len, align 8
  %t1031 = load %struct.File*, %struct.File** %this.ptr, align 8
  %t1032 = getelementptr inbounds %struct.File, %struct.File* %t1031, i32 0, i32 0
  %t1033 = load i64, i64* %t1032, align 8
  %fd = alloca i64, align 8
  store i64 %t1033, i64* %fd, align 8
  %t1034 = load i64, i64* %fd, align 8
  %t1035 = icmp slt i64 %t1034, 0
  br i1 %t1035, label %if.then.5, label %if.end.7
if.then.5:
    %t1036 = bitcast ptr %agg.result to i8*
    %t1037 = bitcast %struct.string* @.string.0 to i8*
    call void @__memcpy_inline(i8* %t1036, i8* %t1037, i64 16)
    ret void
    br label %if.end.7
if.end.7:
  %t1038 = load i64, i64* %p.max_len, align 8
  %t1039 = call i8* @yulang_malloc(i64 %t1038)
  %buf = alloca i8*, align 8
  store i8* %t1039, i8** %buf, align 8
  %t1040 = load i64, i64* %fd, align 8
  %t1041 = load i8*, i8** %buf, align 8
  %t1042 = load i64, i64* %p.max_len, align 8
  %t1043 = ptrtoint i8* %t1041 to i64
  %t1044 = call i64 asm sideeffect "syscall", "={rax},0,{rdi},{rsi},{rdx},{r10},{r8},{r9},~{rcx},~{r11},~{memory}"(i64 0, i64 %t1040, i64 %t1043, i64 %t1042, i64 0, i64 0, i64 0)
  %n = alloca i64, align 8
  store i64 %t1044, i64* %n, align 8
  %t1045 = load i64, i64* %n, align 8
  %t1046 = icmp slt i64 %t1045, 0
  br i1 %t1046, label %if.then.8, label %if.end.10
if.then.8:
    %t1047 = bitcast ptr %agg.result to i8*
    %t1048 = bitcast %struct.string* @.string.0 to i8*
    call void @__memcpy_inline(i8* %t1047, i8* %t1048, i64 16)
    ret void
    br label %if.end.10
if.end.10:
  %t1049 = load i8*, i8** %buf, align 8
  %t1050 = load i64, i64* %n, align 8
  %t1051 = call i8* @yulang_malloc(i64 16)
  %t1052 = bitcast i8* %t1051 to %struct.string*
  %t1053 = getelementptr inbounds %struct.string, %struct.string* %t1052, i32 0, i32 0
  store i8* %t1049, i8** %t1053, align 8
  %t1054 = getelementptr inbounds %struct.string, %struct.string* %t1052, i32 0, i32 1
  store i64 %t1050, i64* %t1054, align 8
  %t1055 = bitcast ptr %agg.result to i8*
  %t1056 = bitcast %struct.string* %t1052 to i8*
  call void @__memcpy_inline(i8* %t1055, i8* %t1056, i64 16)
  ret void
}

define internal i64 @_cls_File_write(%struct.File* %this, %struct.string %content) {
entry:
  %this.ptr = alloca %struct.File*, align 8
  store %struct.File* %this, %struct.File** %this.ptr, align 8
  %p.content = alloca %struct.string, align 8
  store %struct.string %content, %struct.string* %p.content, align 8
  %t1057 = load %struct.File*, %struct.File** %this.ptr, align 8
  %t1058 = getelementptr inbounds %struct.File, %struct.File* %t1057, i32 0, i32 0
  %t1059 = load i64, i64* %t1058, align 8
  %fd = alloca i64, align 8
  store i64 %t1059, i64* %fd, align 8
  %t1060 = load i64, i64* %fd, align 8
  %t1061 = icmp slt i64 %t1060, 0
  br i1 %t1061, label %if.then.11, label %if.end.13
if.then.11:
    %t1062 = sub nsw i64 0, 1
    ret i64 %t1062
    br label %if.end.13
if.end.13:
  %t1063 = load %struct.string, %struct.string* %p.content, align 8
  %t1064 = alloca %struct.string, align 8
  store %struct.string %t1063, %struct.string* %t1064, align 8
  %t1066 = getelementptr inbounds %struct.string, %struct.string* %t1064, i32 0, i32 0
  %t1065 = load i8*, i8** %t1066, align 8
  %t1067 = ptrtoint i8* %t1065 to i64
  %data_ptr = alloca i64, align 8
  store i64 %t1067, i64* %data_ptr, align 8
  %t1068 = load %struct.string, %struct.string* %p.content, align 8
  %t1069 = alloca %struct.string, align 8
  store %struct.string %t1068, %struct.string* %t1069, align 8
  %t1071 = getelementptr inbounds %struct.string, %struct.string* %t1069, i32 0, i32 1
  %t1070 = load i64, i64* %t1071, align 8
  %data_len = alloca i64, align 8
  store i64 %t1070, i64* %data_len, align 8
  %t1072 = load i64, i64* %fd, align 8
  %t1073 = load i64, i64* %data_ptr, align 8
  %t1074 = load i64, i64* %data_len, align 8
  %t1075 = call i64 asm sideeffect "syscall", "={rax},0,{rdi},{rsi},{rdx},{r10},{r8},{r9},~{rcx},~{r11},~{memory}"(i64 1, i64 %t1072, i64 %t1073, i64 %t1074, i64 0, i64 0, i64 0)
  ret i64 %t1075
}

define internal void @_cls_File_close(%struct.File* %this) {
entry:
  %this.ptr = alloca %struct.File*, align 8
  store %struct.File* %this, %struct.File** %this.ptr, align 8
  %t1076 = load %struct.File*, %struct.File** %this.ptr, align 8
  %t1077 = getelementptr inbounds %struct.File, %struct.File* %t1076, i32 0, i32 0
  %t1078 = load i64, i64* %t1077, align 8
  %fd = alloca i64, align 8
  store i64 %t1078, i64* %fd, align 8
  %t1079 = load i64, i64* %fd, align 8
  %t1080 = icmp sge i64 %t1079, 0
  br i1 %t1080, label %if.then.14, label %if.end.16
if.then.14:
    %t1081 = load i64, i64* %fd, align 8
    %t1082 = call i64 asm sideeffect "syscall", "={rax},0,{rdi},{rsi},{rdx},{r10},{r8},{r9},~{rcx},~{r11},~{memory}"(i64 3, i64 %t1081, i64 0, i64 0, i64 0, i64 0, i64 0)
    %t1083 = sub nsw i64 0, 1
    %t1084 = load %struct.File*, %struct.File** %this.ptr, align 8
    %t1085 = getelementptr inbounds %struct.File, %struct.File* %t1084, i32 0, i32 0
    store i64 %t1083, i64* %t1085, align 8
    br label %if.end.16
if.end.16:
  ret void
}

define void @_mod_libs_linux_x86_64_std_io_input(ptr sret(%struct.string) align 8 %agg.result) {
entry:
  %buf_size = alloca i64, align 8
  store i64 1024, i64* %buf_size, align 8
  %t1086 = load i64, i64* %buf_size, align 8
  %t1087 = call i8* @yulang_malloc(i64 %t1086)
  %buf = alloca i8*, align 8
  store i8* %t1087, i8** %buf, align 8
  %t1088 = load i8*, i8** %buf, align 8
  %t1089 = load i64, i64* %buf_size, align 8
  %t1090 = ptrtoint i8* %t1088 to i64
  %t1091 = call i64 asm sideeffect "syscall", "={rax},0,{rdi},{rsi},{rdx},{r10},{r8},{r9},~{rcx},~{r11},~{memory}"(i64 0, i64 0, i64 %t1090, i64 %t1089, i64 0, i64 0, i64 0)
  %read_len = alloca i64, align 8
  store i64 %t1091, i64* %read_len, align 8
  %t1092 = load i8*, i8** %buf, align 8
  %t1093 = load i64, i64* %read_len, align 8
  %t1094 = call i8* @yulang_malloc(i64 16)
  %t1095 = bitcast i8* %t1094 to %struct.string*
  %t1096 = getelementptr inbounds %struct.string, %struct.string* %t1095, i32 0, i32 0
  store i8* %t1092, i8** %t1096, align 8
  %t1097 = getelementptr inbounds %struct.string, %struct.string* %t1095, i32 0, i32 1
  store i64 %t1093, i64* %t1097, align 8
  %t1098 = bitcast ptr %agg.result to i8*
  %t1099 = bitcast %struct.string* %t1095 to i8*
  call void @__memcpy_inline(i8* %t1098, i8* %t1099, i64 16)
  ret void
}

define void @_mod_libs_linux_x86_64_std_io_print(%struct.string %msg) {
entry:
  %p.msg = alloca %struct.string, align 8
  store %struct.string %msg, %struct.string* %p.msg, align 8
  %t1100 = load %struct.string, %struct.string* %p.msg, align 8
  %t1101 = alloca %struct.string, align 8
  store %struct.string %t1100, %struct.string* %t1101, align 8
  %t1103 = getelementptr inbounds %struct.string, %struct.string* %t1101, i32 0, i32 0
  %t1102 = load i8*, i8** %t1103, align 8
  %t1104 = ptrtoint i8* %t1102 to i64
  %p = alloca i64, align 8
  store i64 %t1104, i64* %p, align 8
  %t1105 = load %struct.string, %struct.string* %p.msg, align 8
  %t1106 = alloca %struct.string, align 8
  store %struct.string %t1105, %struct.string* %t1106, align 8
  %t1108 = getelementptr inbounds %struct.string, %struct.string* %t1106, i32 0, i32 1
  %t1107 = load i64, i64* %t1108, align 8
  %l = alloca i64, align 8
  store i64 %t1107, i64* %l, align 8
  %t1109 = load i64, i64* %p, align 8
  %t1110 = load i64, i64* %l, align 8
  %t1111 = call i64 asm sideeffect "syscall", "={rax},0,{rdi},{rsi},{rdx},{r10},{r8},{r9},~{rcx},~{r11},~{memory}"(i64 1, i64 1, i64 %t1109, i64 %t1110, i64 0, i64 0, i64 0)
  ret void
}

define void @_mod_libs_linux_x86_64_std_io_output(%struct.string %msg) {
entry:
  %p.msg = alloca %struct.string, align 8
  store %struct.string %msg, %struct.string* %p.msg, align 8
  %t1112 = load %struct.string, %struct.string* %p.msg, align 8
  call void @_mod_libs_linux_x86_64_std_io_print(%struct.string %t1112)
  ret void
}

define void @_mod_libs_linux_x86_64_std_io_println(%struct.string %msg) {
entry:
  %p.msg = alloca %struct.string, align 8
  store %struct.string %msg, %struct.string* %p.msg, align 8
  %t1113 = load %struct.string, %struct.string* %p.msg, align 8
  call void @_mod_libs_linux_x86_64_std_io_print(%struct.string %t1113)
  %t1114 = load %struct.string, %struct.string* @.string.1, align 8
  call void @_mod_libs_linux_x86_64_std_io_print(%struct.string %t1114)
  ret void
}

%struct.module_libs_linux_x86_64_std_io = type { void (%struct.string*)*, void (%struct.string)*, void (%struct.string)*, void (%struct.string)* }
@module_libs_linux_x86_64_std_io = internal global %struct.module_libs_linux_x86_64_std_io { void (%struct.string*)* @_mod_libs_linux_x86_64_std_io_input, void (%struct.string)* @_mod_libs_linux_x86_64_std_io_print, void (%struct.string)* @_mod_libs_linux_x86_64_std_io_output, void (%struct.string)* @_mod_libs_linux_x86_64_std_io_println }
define i32 @main() {
entry:
  %t1115 = getelementptr inbounds %struct.module_libs_linux_x86_64_std_io, %struct.module_libs_linux_x86_64_std_io* @module_libs_linux_x86_64_std_io, i32 0, i32 2
  %t1116 = load void (%struct.string)*, void (%struct.string)** %t1115, align 8
  %t1117 = load %struct.string, %struct.string* @.string.2, align 8
  call void %t1116(%struct.string %t1117)
  %t1118 = alloca %struct.array.i32, align 8
  store %struct.array.i32 { i32* null, i64 0, i64 0 }, %struct.array.i32* %t1118, align 8
  %t1119 = load %struct.array.i32, %struct.array.i32* %t1118, align 8
  %a = alloca %struct.array.i32, align 8
  store %struct.array.i32 %t1119, %struct.array.i32* %a, align 8
  %t1120 = load %struct.array.i32, %struct.array.i32* %a, align 8
  %t1121 = getelementptr inbounds %struct.array.i32, %struct.array.i32* %a, i32 0, i32 0
  %t1122 = load i32*, i32** %t1121, align 8
  %t1123 = getelementptr inbounds %struct.array.i32, %struct.array.i32* %a, i32 0, i32 1
  %t1124 = load i64, i64* %t1123, align 8
  %t1125 = getelementptr inbounds %struct.array.i32, %struct.array.i32* %a, i32 0, i32 2
  %t1126 = load i64, i64* %t1125, align 8
  %t1127 = icmp uge i64 %t1124, %t1126
  br i1 %t1127, label %array.append.realloc.17, label %array.append.no_realloc.18
array.append.realloc.17:
    %t1129 = icmp eq i64 %t1126, 0
    %t1130 = mul i64 %t1126, 2
    %t1128 = select i1 %t1129, i64 1, i64 %t1130
    %t1131 = mul i64 %t1128, 4
    %t1132 = add i64 %t1131, 7
    %t1133 = and i64 %t1132, -8
    %t1134 = load i8*, i8** @__heap_brk, align 8
    %t1135 = getelementptr inbounds i8, i8* %t1134, i64 %t1133
    %t1136 = ptrtoint i8* %t1135 to i64
    %t1137 = call i64 asm sideeffect "syscall", "={rax},0,{rdi},{rsi},{rdx},{r10},{r8},{r9},~{rcx},~{r11},~{memory}"(i64 12, i64 %t1136, i64 0, i64 0, i64 0, i64 0, i64 0)
    %t1138 = inttoptr i64 %t1137 to i8*
    store i8* %t1138, i8** @__heap_brk, align 8
    %t1139 = bitcast i8* %t1134 to i32*
    %t1140 = icmp ne i32* %t1122, null
    br i1 %t1140, label %array.append.copy_old_data.20, label %array.append.skip_copy_data.21
array.append.copy_old_data.20:
      %t1141 = mul i64 %t1124, 4
      %t1142 = bitcast i32* %t1139 to i8*
      %t1143 = bitcast i32* %t1122 to i8*
    br label %array.append.skip_copy_data.21
array.append.skip_copy_data.21:
    %t1144 = bitcast %t1122 to i8*
    %t1145 = mul i64 %t1126, 4
    %t1146 = add i64 %t1145, 7
    %t1147 = and i64 %t1146, -8
    %t1148 = load i8*, i8** @__heap_brk, align 8
    %t1149 = getelementptr inbounds i8, i8* %t1144, i64 %t1147
    %t1150 = icmp eq i8* %t1149, %t1148
    br i1 %t1150, label %free.top.23, label %free.end.22
free.top.23:
      %t1151 = ptrtoint i8* %t1144 to i64
      %t1152 = call i64 asm sideeffect "syscall", "={rax},0,{rdi},{rsi},{rdx},{r10},{r8},{r9},~{rcx},~{r11},~{memory}"(i64 12, i64 %t1151, i64 0, i64 0, i64 0, i64 0, i64 0)
      store i8* %t1144, i8** @__heap_brk, align 8
      br label %free.end.22
free.end.22:
    store i32* %t1139, i32** %t1121, align 8
    store i64 %t1128, i64* %t1125, align 8
    br label %array.append.continue.19
array.append.no_realloc.18:
    br label %array.append.continue.19
array.append.continue.19:
  %t1153 = load i32*, i32** %t1121, align 8
  %t1154 = getelementptr inbounds i32, i32* %t1153, i64 %t1124
  %t1155 = trunc i64 1 to i32
  store i32 %t1155, i32* %t1154, align 4
  %t1156 = add i64 %t1124, 1
  store i64 %t1156, i64* %t1123, align 8
  %t1157 = load %struct.array.i32, %struct.array.i32* %a, align 8
  %t1158 = load %struct.array.i32, %struct.array.i32* %a, align 8
  %t1159 = getelementptr inbounds %struct.array.i32, %struct.array.i32* %a, i32 0, i32 0
  %t1160 = load i32*, i32** %t1159, align 8
  %t1161 = getelementptr inbounds %struct.array.i32, %struct.array.i32* %a, i32 0, i32 1
  %t1162 = load i64, i64* %t1161, align 8
  %t1163 = getelementptr inbounds %struct.array.i32, %struct.array.i32* %a, i32 0, i32 2
  %t1164 = load i64, i64* %t1163, align 8
  %t1165 = icmp uge i64 %t1162, %t1164
  br i1 %t1165, label %array.append.realloc.24, label %array.append.no_realloc.25
array.append.realloc.24:
    %t1167 = icmp eq i64 %t1164, 0
    %t1168 = mul i64 %t1164, 2
    %t1166 = select i1 %t1167, i64 1, i64 %t1168
    %t1169 = mul i64 %t1166, 4
    %t1170 = add i64 %t1169, 7
    %t1171 = and i64 %t1170, -8
    %t1172 = load i8*, i8** @__heap_brk, align 8
    %t1173 = getelementptr inbounds i8, i8* %t1172, i64 %t1171
    %t1174 = ptrtoint i8* %t1173 to i64
    %t1175 = call i64 asm sideeffect "syscall", "={rax},0,{rdi},{rsi},{rdx},{r10},{r8},{r9},~{rcx},~{r11},~{memory}"(i64 12, i64 %t1174, i64 0, i64 0, i64 0, i64 0, i64 0)
    %t1176 = inttoptr i64 %t1175 to i8*
    store i8* %t1176, i8** @__heap_brk, align 8
    %t1177 = bitcast i8* %t1172 to i32*
    %t1178 = icmp ne i32* %t1160, null
    br i1 %t1178, label %array.append.copy_old_data.27, label %array.append.skip_copy_data.28
array.append.copy_old_data.27:
      %t1179 = mul i64 %t1162, 4
      %t1180 = bitcast i32* %t1177 to i8*
      %t1181 = bitcast i32* %t1160 to i8*
    br label %array.append.skip_copy_data.28
array.append.skip_copy_data.28:
    %t1182 = bitcast %t1160 to i8*
    %t1183 = mul i64 %t1164, 4
    %t1184 = add i64 %t1183, 7
    %t1185 = and i64 %t1184, -8
    %t1186 = load i8*, i8** @__heap_brk, align 8
    %t1187 = getelementptr inbounds i8, i8* %t1182, i64 %t1185
    %t1188 = icmp eq i8* %t1187, %t1186
    br i1 %t1188, label %free.top.30, label %free.end.29
free.top.30:
      %t1189 = ptrtoint i8* %t1182 to i64
      %t1190 = call i64 asm sideeffect "syscall", "={rax},0,{rdi},{rsi},{rdx},{r10},{r8},{r9},~{rcx},~{r11},~{memory}"(i64 12, i64 %t1189, i64 0, i64 0, i64 0, i64 0, i64 0)
      store i8* %t1182, i8** @__heap_brk, align 8
      br label %free.end.29
free.end.29:
    store i32* %t1177, i32** %t1159, align 8
    store i64 %t1166, i64* %t1163, align 8
    br label %array.append.continue.26
array.append.no_realloc.25:
    br label %array.append.continue.26
array.append.continue.26:
  %t1191 = load i32*, i32** %t1159, align 8
  %t1192 = getelementptr inbounds i32, i32* %t1191, i64 %t1162
  %t1193 = trunc i64 2 to i32
  store i32 %t1193, i32* %t1192, align 4
  %t1194 = add i64 %t1162, 1
  store i64 %t1194, i64* %t1161, align 8
  %t1195 = load %struct.array.i32, %struct.array.i32* %a, align 8
  %t1196 = load %struct.array.i32, %struct.array.i32* %a, align 8
  %t1197 = getelementptr inbounds %struct.array.i32, %struct.array.i32* %a, i32 0, i32 0
  %t1198 = load i32*, i32** %t1197, align 8
  %t1199 = getelementptr inbounds %struct.array.i32, %struct.array.i32* %a, i32 0, i32 1
  %t1200 = load i64, i64* %t1199, align 8
  %t1201 = getelementptr inbounds %struct.array.i32, %struct.array.i32* %a, i32 0, i32 2
  %t1202 = load i64, i64* %t1201, align 8
  %t1203 = icmp uge i64 %t1200, %t1202
  br i1 %t1203, label %array.append.realloc.31, label %array.append.no_realloc.32
array.append.realloc.31:
    %t1205 = icmp eq i64 %t1202, 0
    %t1206 = mul i64 %t1202, 2
    %t1204 = select i1 %t1205, i64 1, i64 %t1206
    %t1207 = mul i64 %t1204, 4
    %t1208 = add i64 %t1207, 7
    %t1209 = and i64 %t1208, -8
    %t1210 = load i8*, i8** @__heap_brk, align 8
    %t1211 = getelementptr inbounds i8, i8* %t1210, i64 %t1209
    %t1212 = ptrtoint i8* %t1211 to i64
    %t1213 = call i64 asm sideeffect "syscall", "={rax},0,{rdi},{rsi},{rdx},{r10},{r8},{r9},~{rcx},~{r11},~{memory}"(i64 12, i64 %t1212, i64 0, i64 0, i64 0, i64 0, i64 0)
    %t1214 = inttoptr i64 %t1213 to i8*
    store i8* %t1214, i8** @__heap_brk, align 8
    %t1215 = bitcast i8* %t1210 to i32*
    %t1216 = icmp ne i32* %t1198, null
    br i1 %t1216, label %array.append.copy_old_data.34, label %array.append.skip_copy_data.35
array.append.copy_old_data.34:
      %t1217 = mul i64 %t1200, 4
      %t1218 = bitcast i32* %t1215 to i8*
      %t1219 = bitcast i32* %t1198 to i8*
    br label %array.append.skip_copy_data.35
array.append.skip_copy_data.35:
    %t1220 = bitcast %t1198 to i8*
    %t1221 = mul i64 %t1202, 4
    %t1222 = add i64 %t1221, 7
    %t1223 = and i64 %t1222, -8
    %t1224 = load i8*, i8** @__heap_brk, align 8
    %t1225 = getelementptr inbounds i8, i8* %t1220, i64 %t1223
    %t1226 = icmp eq i8* %t1225, %t1224
    br i1 %t1226, label %free.top.37, label %free.end.36
free.top.37:
      %t1227 = ptrtoint i8* %t1220 to i64
      %t1228 = call i64 asm sideeffect "syscall", "={rax},0,{rdi},{rsi},{rdx},{r10},{r8},{r9},~{rcx},~{r11},~{memory}"(i64 12, i64 %t1227, i64 0, i64 0, i64 0, i64 0, i64 0)
      store i8* %t1220, i8** @__heap_brk, align 8
      br label %free.end.36
free.end.36:
    store i32* %t1215, i32** %t1197, align 8
    store i64 %t1204, i64* %t1201, align 8
    br label %array.append.continue.33
array.append.no_realloc.32:
    br label %array.append.continue.33
array.append.continue.33:
  %t1229 = load i32*, i32** %t1197, align 8
  %t1230 = getelementptr inbounds i32, i32* %t1229, i64 %t1200
  %t1231 = trunc i64 3 to i32
  store i32 %t1231, i32* %t1230, align 4
  %t1232 = add i64 %t1200, 1
  store i64 %t1232, i64* %t1199, align 8
  %t1233 = load %struct.array.i32, %struct.array.i32* %a, align 8
  %t1234 = getelementptr inbounds %struct.module_libs_linux_x86_64_std_io, %struct.module_libs_linux_x86_64_std_io* @module_libs_linux_x86_64_std_io, i32 0, i32 2
  %t1235 = load void (%struct.string)*, void (%struct.string)** %t1234, align 8
  %t1236 = load %struct.array.i32, %struct.array.i32* %a, align 8
  %t1237 = getelementptr inbounds %struct.array.i32, %struct.array.i32* %a, i32 0, i32 0
  %t1238 = load i32*, i32** %t1237, align 8
  %t1239 = getelementptr inbounds %struct.array.i32, %struct.array.i32* %a, i32 0, i32 1
  %t1240 = load i64, i64* %t1239, align 8
  %t1241 = icmp uge i64 0, %t1240
  br i1 %t1241, label %array.get.oob.39, label %array.get.inbounds.38
array.get.oob.39:
  call void @__panic_oob()
  unreachable
array.get.inbounds.38:
  %t1242 = getelementptr inbounds i32, i32* %t1238, i64 0
  %t1243 = load i32, i32* %t1242, align 4
  %t1244 = sext i32 %t1243 to i64
  %t1245 = alloca %struct.string*, align 8
  %t1246 = icmp eq i64 %t1244, 0
  br i1 %t1246, label %tostr.iszero.40, label %tostr.notzero.41
tostr.iszero.40:
  %t1247 = call i8* @yulang_malloc(i64 1)
  store i8 48, i8* %t1247, align 1
  %t1248 = alloca %struct.string, align 8
  %t1249 = getelementptr inbounds %struct.string, %struct.string* %t1248, i32 0, i32 0
  store i8* %t1247, i8** %t1249, align 8
  %t1250 = getelementptr inbounds %struct.string, %struct.string* %t1248, i32 0, i32 1
  store i64 1, i64* %t1250, align 8
  store %struct.string* %t1248, %struct.string** %t1245, align 8
  br label %tostr.exit.42
tostr.notzero.41:
  %t1251 = alloca i8, i64 21, align 1
  %t1252 = getelementptr i8, i8* %t1251, i64 21
  %t1253 = alloca i8*, align 8
  store i8* %t1252, i8** %t1253, align 8
  %t1254 = icmp slt i64 %t1244, 0
  %t1256 = sub i64 0, %t1244
  %t1255 = select i1 %t1254, i64 %t1256, i64 %t1244
  %t1257 = alloca i64, align 8
  store i64 %t1255, i64* %t1257, align 8
  br label %tostr.loop.header.43
tostr.loop.header.43:
  %t1258 = load i64, i64* %t1257, align 8
  %t1259 = icmp ne i64 %t1258, 0
  br i1 %t1259, label %tostr.loop.body.44, label %tostr.loop.end.45
tostr.loop.body.44:
  %t1260 = load i8*, i8** %t1253, align 8
  %t1261 = getelementptr i8, i8* %t1260, i64 -1
  store i8* %t1261, i8** %t1253, align 8
  %t1262 = load i64, i64* %t1257, align 8
  %t1263 = srem i64 %t1262, 10
  %t1264 = sdiv i64 %t1262, 10
  store i64 %t1264, i64* %t1257, align 8
  %t1265 = add i64 %t1263, 48
  %t1266 = trunc i64 %t1265 to i8
  store i8 %t1266, i8* %t1261, align 1
  br label %tostr.loop.header.43
tostr.loop.end.45:
  br i1 %t1254, label %tostr.addsign.46, label %tostr.sign.end.47
tostr.addsign.46:
  %t1267 = load i8*, i8** %t1253, align 8
  %t1268 = getelementptr i8, i8* %t1267, i64 -1
  store i8* %t1268, i8** %t1253, align 8
  store i8 45, i8* %t1268, align 1
  br label %tostr.sign.end.47
tostr.sign.end.47:
  %t1269 = load i8*, i8** %t1253, align 8
  %t1271 = ptrtoint i8* %t1252 to i64
  %t1272 = ptrtoint i8* %t1269 to i64
  %t1270 = sub i64 %t1271, %t1272
  %t1273 = call i8* @yulang_malloc(i64 %t1270)
  call void @__memcpy_inline(i8* %t1273, i8* %t1269, i64 %t1270)
  %t1274 = alloca %struct.string, align 8
  %t1275 = getelementptr inbounds %struct.string, %struct.string* %t1274, i32 0, i32 0
  store i8* %t1273, i8** %t1275, align 8
  %t1276 = getelementptr inbounds %struct.string, %struct.string* %t1274, i32 0, i32 1
  store i64 %t1270, i64* %t1276, align 8
  store %struct.string* %t1274, %struct.string** %t1245, align 8
  br label %tostr.exit.42
tostr.exit.42:
  %t1277 = load %struct.string*, %struct.string** %t1245, align 8
  %t1278 = load %struct.string, %struct.string* %t1277, align 8
  call void %t1235(%struct.string %t1278)
  %t1279 = getelementptr inbounds %struct.module_libs_linux_x86_64_std_io, %struct.module_libs_linux_x86_64_std_io* @module_libs_linux_x86_64_std_io, i32 0, i32 2
  %t1280 = load void (%struct.string)*, void (%struct.string)** %t1279, align 8
  %t1281 = load %struct.array.i32, %struct.array.i32* %a, align 8
  %t1282 = getelementptr inbounds %struct.array.i32, %struct.array.i32* %a, i32 0, i32 0
  %t1283 = load i32*, i32** %t1282, align 8
  %t1284 = getelementptr inbounds %struct.array.i32, %struct.array.i32* %a, i32 0, i32 1
  %t1285 = load i64, i64* %t1284, align 8
  %t1286 = icmp uge i64 1, %t1285
  br i1 %t1286, label %array.get.oob.49, label %array.get.inbounds.48
array.get.oob.49:
  call void @__panic_oob()
  unreachable
array.get.inbounds.48:
  %t1287 = getelementptr inbounds i32, i32* %t1283, i64 1
  %t1288 = load i32, i32* %t1287, align 4
  %t1289 = sext i32 %t1288 to i64
  %t1290 = alloca %struct.string*, align 8
  %t1291 = icmp eq i64 %t1289, 0
  br i1 %t1291, label %tostr.iszero.50, label %tostr.notzero.51
tostr.iszero.50:
  %t1292 = call i8* @yulang_malloc(i64 1)
  store i8 48, i8* %t1292, align 1
  %t1293 = alloca %struct.string, align 8
  %t1294 = getelementptr inbounds %struct.string, %struct.string* %t1293, i32 0, i32 0
  store i8* %t1292, i8** %t1294, align 8
  %t1295 = getelementptr inbounds %struct.string, %struct.string* %t1293, i32 0, i32 1
  store i64 1, i64* %t1295, align 8
  store %struct.string* %t1293, %struct.string** %t1290, align 8
  br label %tostr.exit.52
tostr.notzero.51:
  %t1296 = alloca i8, i64 21, align 1
  %t1297 = getelementptr i8, i8* %t1296, i64 21
  %t1298 = alloca i8*, align 8
  store i8* %t1297, i8** %t1298, align 8
  %t1299 = icmp slt i64 %t1289, 0
  %t1301 = sub i64 0, %t1289
  %t1300 = select i1 %t1299, i64 %t1301, i64 %t1289
  %t1302 = alloca i64, align 8
  store i64 %t1300, i64* %t1302, align 8
  br label %tostr.loop.header.53
tostr.loop.header.53:
  %t1303 = load i64, i64* %t1302, align 8
  %t1304 = icmp ne i64 %t1303, 0
  br i1 %t1304, label %tostr.loop.body.54, label %tostr.loop.end.55
tostr.loop.body.54:
  %t1305 = load i8*, i8** %t1298, align 8
  %t1306 = getelementptr i8, i8* %t1305, i64 -1
  store i8* %t1306, i8** %t1298, align 8
  %t1307 = load i64, i64* %t1302, align 8
  %t1308 = srem i64 %t1307, 10
  %t1309 = sdiv i64 %t1307, 10
  store i64 %t1309, i64* %t1302, align 8
  %t1310 = add i64 %t1308, 48
  %t1311 = trunc i64 %t1310 to i8
  store i8 %t1311, i8* %t1306, align 1
  br label %tostr.loop.header.53
tostr.loop.end.55:
  br i1 %t1299, label %tostr.addsign.56, label %tostr.sign.end.57
tostr.addsign.56:
  %t1312 = load i8*, i8** %t1298, align 8
  %t1313 = getelementptr i8, i8* %t1312, i64 -1
  store i8* %t1313, i8** %t1298, align 8
  store i8 45, i8* %t1313, align 1
  br label %tostr.sign.end.57
tostr.sign.end.57:
  %t1314 = load i8*, i8** %t1298, align 8
  %t1316 = ptrtoint i8* %t1297 to i64
  %t1317 = ptrtoint i8* %t1314 to i64
  %t1315 = sub i64 %t1316, %t1317
  %t1318 = call i8* @yulang_malloc(i64 %t1315)
  call void @__memcpy_inline(i8* %t1318, i8* %t1314, i64 %t1315)
  %t1319 = alloca %struct.string, align 8
  %t1320 = getelementptr inbounds %struct.string, %struct.string* %t1319, i32 0, i32 0
  store i8* %t1318, i8** %t1320, align 8
  %t1321 = getelementptr inbounds %struct.string, %struct.string* %t1319, i32 0, i32 1
  store i64 %t1315, i64* %t1321, align 8
  store %struct.string* %t1319, %struct.string** %t1290, align 8
  br label %tostr.exit.52
tostr.exit.52:
  %t1322 = load %struct.string*, %struct.string** %t1290, align 8
  %t1323 = load %struct.string, %struct.string* %t1322, align 8
  call void %t1280(%struct.string %t1323)
  %t1324 = getelementptr inbounds %struct.module_libs_linux_x86_64_std_io, %struct.module_libs_linux_x86_64_std_io* @module_libs_linux_x86_64_std_io, i32 0, i32 2
  %t1325 = load void (%struct.string)*, void (%struct.string)** %t1324, align 8
  %t1326 = load %struct.array.i32, %struct.array.i32* %a, align 8
  %t1327 = getelementptr inbounds %struct.array.i32, %struct.array.i32* %a, i32 0, i32 0
  %t1328 = load i32*, i32** %t1327, align 8
  %t1329 = getelementptr inbounds %struct.array.i32, %struct.array.i32* %a, i32 0, i32 1
  %t1330 = load i64, i64* %t1329, align 8
  %t1331 = icmp uge i64 2, %t1330
  br i1 %t1331, label %array.get.oob.59, label %array.get.inbounds.58
array.get.oob.59:
  call void @__panic_oob()
  unreachable
array.get.inbounds.58:
  %t1332 = getelementptr inbounds i32, i32* %t1328, i64 2
  %t1333 = load i32, i32* %t1332, align 4
  %t1334 = sext i32 %t1333 to i64
  %t1335 = alloca %struct.string*, align 8
  %t1336 = icmp eq i64 %t1334, 0
  br i1 %t1336, label %tostr.iszero.60, label %tostr.notzero.61
tostr.iszero.60:
  %t1337 = call i8* @yulang_malloc(i64 1)
  store i8 48, i8* %t1337, align 1
  %t1338 = alloca %struct.string, align 8
  %t1339 = getelementptr inbounds %struct.string, %struct.string* %t1338, i32 0, i32 0
  store i8* %t1337, i8** %t1339, align 8
  %t1340 = getelementptr inbounds %struct.string, %struct.string* %t1338, i32 0, i32 1
  store i64 1, i64* %t1340, align 8
  store %struct.string* %t1338, %struct.string** %t1335, align 8
  br label %tostr.exit.62
tostr.notzero.61:
  %t1341 = alloca i8, i64 21, align 1
  %t1342 = getelementptr i8, i8* %t1341, i64 21
  %t1343 = alloca i8*, align 8
  store i8* %t1342, i8** %t1343, align 8
  %t1344 = icmp slt i64 %t1334, 0
  %t1346 = sub i64 0, %t1334
  %t1345 = select i1 %t1344, i64 %t1346, i64 %t1334
  %t1347 = alloca i64, align 8
  store i64 %t1345, i64* %t1347, align 8
  br label %tostr.loop.header.63
tostr.loop.header.63:
  %t1348 = load i64, i64* %t1347, align 8
  %t1349 = icmp ne i64 %t1348, 0
  br i1 %t1349, label %tostr.loop.body.64, label %tostr.loop.end.65
tostr.loop.body.64:
  %t1350 = load i8*, i8** %t1343, align 8
  %t1351 = getelementptr i8, i8* %t1350, i64 -1
  store i8* %t1351, i8** %t1343, align 8
  %t1352 = load i64, i64* %t1347, align 8
  %t1353 = srem i64 %t1352, 10
  %t1354 = sdiv i64 %t1352, 10
  store i64 %t1354, i64* %t1347, align 8
  %t1355 = add i64 %t1353, 48
  %t1356 = trunc i64 %t1355 to i8
  store i8 %t1356, i8* %t1351, align 1
  br label %tostr.loop.header.63
tostr.loop.end.65:
  br i1 %t1344, label %tostr.addsign.66, label %tostr.sign.end.67
tostr.addsign.66:
  %t1357 = load i8*, i8** %t1343, align 8
  %t1358 = getelementptr i8, i8* %t1357, i64 -1
  store i8* %t1358, i8** %t1343, align 8
  store i8 45, i8* %t1358, align 1
  br label %tostr.sign.end.67
tostr.sign.end.67:
  %t1359 = load i8*, i8** %t1343, align 8
  %t1361 = ptrtoint i8* %t1342 to i64
  %t1362 = ptrtoint i8* %t1359 to i64
  %t1360 = sub i64 %t1361, %t1362
  %t1363 = call i8* @yulang_malloc(i64 %t1360)
  call void @__memcpy_inline(i8* %t1363, i8* %t1359, i64 %t1360)
  %t1364 = alloca %struct.string, align 8
  %t1365 = getelementptr inbounds %struct.string, %struct.string* %t1364, i32 0, i32 0
  store i8* %t1363, i8** %t1365, align 8
  %t1366 = getelementptr inbounds %struct.string, %struct.string* %t1364, i32 0, i32 1
  store i64 %t1360, i64* %t1366, align 8
  store %struct.string* %t1364, %struct.string** %t1335, align 8
  br label %tostr.exit.62
tostr.exit.62:
  %t1367 = load %struct.string*, %struct.string** %t1335, align 8
  %t1368 = load %struct.string, %struct.string* %t1367, align 8
  call void %t1325(%struct.string %t1368)
  %t1369 = trunc i64 0 to i32
  ret i32 %t1369
}


@.str.0 = private unnamed_addr constant [1 x i8] c"\00", align 1
@.string.0 = private unnamed_addr constant %struct.string { i8* getelementptr inbounds ([1 x i8], [1 x i8]* @.str.0, i64 0, i64 0), i64 0}, align 8
@.str.1 = private unnamed_addr constant [2 x i8] c"\0A\00", align 1
@.string.1 = private unnamed_addr constant %struct.string { i8* getelementptr inbounds ([2 x i8], [2 x i8]* @.str.1, i64 0, i64 0), i64 1}, align 8
@.str.2 = private unnamed_addr constant [7 x i8] c"hello\0A\00", align 1
@.string.2 = private unnamed_addr constant %struct.string { i8* getelementptr inbounds ([7 x i8], [7 x i8]* @.str.2, i64 0, i64 0), i64 6}, align 8
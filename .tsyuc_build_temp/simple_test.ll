target triple = "aarch64-unknown-linux-gnu"
target datalayout = "e-m:e-i8:8:32-i16:16:32-i64:64-i128:128-n32:64-S128"
%struct.string = type { i8*, i64 }
%struct.object = type {}
declare void @__panic_oob()
%struct.array._struct_string = type { %struct.string*, i64, i64 }
define internal void @__heap_init_internal() {
  %t1000 = load i1, i1* @__heap_initialized, align 1
  br i1 %t1000, label %heap.init.done.0, label %heap.init.do.1
heap.init.do.1:
    %t1001 = call i64 asm sideeffect "svc #0", "={x0},{x8},{x0},{x1},{x2},{x3},{x4},{x5},{x6},{x7},~{x2},~{x3},~{x4},~{x5},~{x6},~{x7},~{x30},~{memory}"(i64 12, i64 0, i64 0, i64 0, i64 0, i64 0, i64 0, i64 0, i64 0)
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
  %t1008 = call i64 asm sideeffect "svc #0", "={x0},{x8},{x0},{x1},{x2},{x3},{x4},{x5},{x6},{x7},~{x2},~{x3},~{x4},~{x5},~{x6},~{x7},~{x30},~{memory}"(i64 12, i64 %t1007, i64 0, i64 0, i64 0, i64 0, i64 0, i64 0, i64 0)
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
  %t1017 = call i64 asm sideeffect "svc #0", "={x0},{x8},{x0},{x1},{x2},{x3},{x4},{x5},i,i,~{x2},~{x3},~{x4},~{x5},~{x6},~{x7},~{x30},~{memory}"(i64 %n, i64 %a1, i64 %a2, i64 %a3, i64 %a4, i64 %a5, i64 %a6, i64 0, i64 0)
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
  %t1027 = call i64 asm sideeffect "svc #0", "={x0},{x8},{x0},{x1},{x2},{x3},{x4},{x5},{x6},{x7},~{x2},~{x3},~{x4},~{x5},~{x6},~{x7},~{x30},~{memory}"(i64 56, i64 0, i64 %t1024, i64 %t1025, i64 %t1026, i64 0, i64 0, i64 0, i64 0)
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
  %t1044 = call i64 asm sideeffect "svc #0", "={x0},{x8},{x0},{x1},{x2},{x3},{x4},{x5},{x6},{x7},~{x2},~{x3},~{x4},~{x5},~{x6},~{x7},~{x30},~{memory}"(i64 63, i64 %t1040, i64 %t1043, i64 %t1042, i64 0, i64 0, i64 0, i64 0, i64 0)
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
  %t1075 = call i64 asm sideeffect "svc #0", "={x0},{x8},{x0},{x1},{x2},{x3},{x4},{x5},{x6},{x7},~{x2},~{x3},~{x4},~{x5},~{x6},~{x7},~{x30},~{memory}"(i64 64, i64 %t1072, i64 %t1073, i64 %t1074, i64 0, i64 0, i64 0, i64 0, i64 0)
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
    %t1082 = call i64 asm sideeffect "svc #0", "={x0},{x8},{x0},{x1},{x2},{x3},{x4},{x5},{x6},{x7},~{x2},~{x3},~{x4},~{x5},~{x6},~{x7},~{x30},~{memory}"(i64 57, i64 %t1081, i64 0, i64 0, i64 0, i64 0, i64 0, i64 0, i64 0)
    %t1083 = sub nsw i64 0, 1
    %t1084 = load %struct.File*, %struct.File** %this.ptr, align 8
    %t1085 = getelementptr inbounds %struct.File, %struct.File* %t1084, i32 0, i32 0
    store i64 %t1083, i64* %t1085, align 8
    br label %if.end.16
if.end.16:
  ret void
}

define void @_mod_libs_linux_arm64_std_io_input(ptr sret(%struct.string) align 8 %agg.result) {
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
  %t1091 = call i64 asm sideeffect "svc #0", "={x0},{x8},{x0},{x1},{x2},{x3},{x4},{x5},{x6},{x7},~{x2},~{x3},~{x4},~{x5},~{x6},~{x7},~{x30},~{memory}"(i64 63, i64 0, i64 %t1090, i64 %t1089, i64 0, i64 0, i64 0, i64 0, i64 0)
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

define void @_mod_libs_linux_arm64_std_io_print(%struct.string %msg) {
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
  %t1111 = call i64 asm sideeffect "svc #0", "={x0},{x8},{x0},{x1},{x2},{x3},{x4},{x5},{x6},{x7},~{x2},~{x3},~{x4},~{x5},~{x6},~{x7},~{x30},~{memory}"(i64 64, i64 1, i64 %t1109, i64 %t1110, i64 0, i64 0, i64 0, i64 0, i64 0)
  ret void
}

define void @_mod_libs_linux_arm64_std_io_output(%struct.string %msg) {
entry:
  %p.msg = alloca %struct.string, align 8
  store %struct.string %msg, %struct.string* %p.msg, align 8
  %t1112 = load %struct.string, %struct.string* %p.msg, align 8
  call void @_mod_libs_linux_arm64_std_io_print(%struct.string %t1112)
  ret void
}

define void @_mod_libs_linux_arm64_std_io_println(%struct.string %msg) {
entry:
  %p.msg = alloca %struct.string, align 8
  store %struct.string %msg, %struct.string* %p.msg, align 8
  %t1113 = load %struct.string, %struct.string* %p.msg, align 8
  call void @_mod_libs_linux_arm64_std_io_print(%struct.string %t1113)
  %t1114 = load %struct.string, %struct.string* @.string.1, align 8
  call void @_mod_libs_linux_arm64_std_io_print(%struct.string %t1114)
  ret void
}

%struct.module_libs_linux_arm64_std_io = type { void (%struct.string*)*, void (%struct.string)*, void (%struct.string)*, void (%struct.string)* }
@module_libs_linux_arm64_std_io = internal global %struct.module_libs_linux_arm64_std_io { void (%struct.string*)* @_mod_libs_linux_arm64_std_io_input, void (%struct.string)* @_mod_libs_linux_arm64_std_io_print, void (%struct.string)* @_mod_libs_linux_arm64_std_io_output, void (%struct.string)* @_mod_libs_linux_arm64_std_io_println }
declare i8* @_prog_yulang_malloc(i64)
declare void @_prog_memcpy(i8*, i8*, i64)
define internal i32 @_prog__yulang_main_entry_intermediate(i32 %argc, i8** %argv_raw) {
entry:
  %p.argc = alloca i32, align 4
  store i32 %argc, i32* %p.argc, align 4
  %p.argv_raw = alloca i8**, align 8
  store i8** %argv_raw, i8*** %p.argv_raw, align 8
  %t1115 = call i8* @_prog_yulang_malloc(i64 24)
  %raw_array_ptr = alloca i8*, align 8
  store i8* %t1115, i8** %raw_array_ptr, align 8
  %t1116 = load i8*, i8** %raw_array_ptr, align 8
  %t1117 = bitcast i8* %t1116 to %struct.array._struct_string*
  %array_struct_ptr = alloca %struct.array._struct_string*, align 8
  store %struct.array._struct_string* %t1117, %struct.array._struct_string** %array_struct_ptr, align 8
  %t1118 = load %struct.array._struct_string*, %struct.array._struct_string** %array_struct_ptr, align 8
  %t1119 = getelementptr inbounds %struct.array._struct_string, %struct.array._struct_string* %t1118, i32 0, i32 1
  %t1120 = load i32, i32* %p.argc, align 4
  %t1121 = sext i32 %t1120 to i64
  store i64 %t1121, i64* %t1119, align 8
  %t1122 = load %struct.array._struct_string*, %struct.array._struct_string** %array_struct_ptr, align 8
  %t1123 = getelementptr inbounds %struct.array._struct_string, %struct.array._struct_string* %t1122, i32 0, i32 2
  %t1124 = load i32, i32* %p.argc, align 4
  %t1125 = sext i32 %t1124 to i64
  store i64 %t1125, i64* %t1123, align 8
  %t1126 = load i32, i32* %p.argc, align 4
  %t1127 = sext i32 %t1126 to i64
  %t1128 = mul nsw i64 %t1127, 8
  %string_struct_array_size = alloca i64, align 8
  store i64 %t1128, i64* %string_struct_array_size, align 8
  %t1129 = load i64, i64* %string_struct_array_size, align 8
  %t1130 = call i8* @_prog_yulang_malloc(i64 %t1129)
  %raw_string_array_ptr = alloca i8*, align 8
  store i8* %t1130, i8** %raw_string_array_ptr, align 8
  %t1131 = load i8*, i8** %raw_string_array_ptr, align 8
  %t1132 = bitcast i8* %t1131 to %struct.string**
  %string_struct_array_ptr = alloca %struct.string**, align 8
  store %struct.string** %t1132, %struct.string*** %string_struct_array_ptr, align 8
  %t1133 = load %struct.array._struct_string*, %struct.array._struct_string** %array_struct_ptr, align 8
  %t1134 = load %struct.string**, %struct.string*** %string_struct_array_ptr, align 8
  %t1135 = bitcast %struct.string** %t1134 to %struct.array._struct_string
  store %struct.array._struct_string %t1135, %struct.array._struct_string* %t1133, align 8
  %i = alloca i32, align 4
  store i32 0, i32* %i, align 4
  br label %while.header.17
while.header.17:
    %t1136 = load i32, i32* %i, align 4
    %t1137 = load i32, i32* %p.argc, align 4
    %t1138 = icmp slt i32 %t1136, %t1137
    br i1 %t1138, label %while.body.18, label %while.end.19
while.body.18:
    %t1139 = load i8**, i8*** %p.argv_raw, align 8
    %t1140 = load i32, i32* %i, align 4
    %t1141 = sext i32 %t1140 to i64
    %t1142 = mul nsw i64 %t1141, 8
    %t1143 = bitcast i8** %t1139 to i8*
    %t1144 = getelementptr i8, i8* %t1143, i64 %t1142
    %t1145 = bitcast i8* %t1144 to i8**
    %current_char_ptr_ptr = alloca i8**, align 8
    store i8** %t1145, i8*** %current_char_ptr_ptr, align 8
    %t1146 = load i8**, i8*** %current_char_ptr_ptr, align 8
    %t1147 = load i8*, i8** %t1146, align 8
    %current_char_ptr = alloca i8*, align 8
    store i8* %t1147, i8** %current_char_ptr, align 8
    %t1148 = load i8*, i8** %current_char_ptr, align 8
    %t1149 = alloca i8*, align 8
    store i8* %t1148, i8** %t1149, align 8
    %t1150 = alloca i64, align 8
    store i64 0, i64* %t1150, align 8
    br label %cstr_strlen.loop.20
cstr_strlen.loop.20:
    %t1151 = load i8*, i8** %t1149, align 8
    %t1152 = load i8, i8* %t1151, align 1
    %t1153 = icmp eq i8 %t1152, 0
    br i1 %t1153, label %cstr_strlen.exit.21, label %cstr_strlen.body.22
cstr_strlen.body.23:
    %t1154 = load i64, i64* %t1150, align 8
    %t1155 = add i64 %t1154, 1
    store i64 %t1155, i64* %t1150, align 8
    %t1156 = getelementptr i8, i8* %t1151, i64 1
    store i8* %t1156, i8** %t1149, align 8
    br label %cstr_strlen.loop.20
cstr_strlen.exit.21:
    %t1157 = load i64, i64* %t1150, align 8
    %len = alloca i64, align 8
    store i64 %t1157, i64* %len, align 8
    %t1158 = call i8* @_prog_yulang_malloc(i64 16)
    %t1159 = bitcast i8* %t1158 to %struct.string*
    %string_struct_ptr = alloca %struct.string*, align 8
    store %struct.string* %t1159, %struct.string** %string_struct_ptr, align 8
    %t1160 = load %struct.string*, %struct.string** %string_struct_ptr, align 8
    %t1161 = bitcast %struct.string* %t1160 to i8*
    %t1162 = getelementptr i8, i8* %t1161, i64 8
    %t1163 = bitcast i8* %t1162 to %struct.string*
    %t1164 = load i64, i64* %len, align 8
    %t1165 = bitcast i64 %t1164 to %struct.string
    store %struct.string %t1165, %struct.string* %t1163, align 8
    %t1166 = load i64, i64* %len, align 8
    %t1167 = add nsw i64 %t1166, 1
    %char_data_size = alloca i64, align 8
    store i64 %t1167, i64* %char_data_size, align 8
    %t1168 = load i64, i64* %char_data_size, align 8
    %t1169 = call i8* @_prog_yulang_malloc(i64 %t1168)
    %char_data_ptr = alloca i8*, align 8
    store i8* %t1169, i8** %char_data_ptr, align 8
    %t1170 = load %struct.string*, %struct.string** %string_struct_ptr, align 8
    %t1171 = bitcast %struct.string* %t1170 to i8*
    %t1172 = getelementptr i8, i8* %t1171, i64 0
    %t1173 = bitcast i8* %t1172 to %struct.string*
    %t1174 = load i8*, i8** %char_data_ptr, align 8
    %t1175 = bitcast i8* %t1174 to %struct.string
    store %struct.string %t1175, %struct.string* %t1173, align 8
    %t1176 = load i8*, i8** %char_data_ptr, align 8
    %t1177 = load i8*, i8** %current_char_ptr, align 8
    %t1178 = load i64, i64* %char_data_size, align 8
    call void @_prog_memcpy(i8* %t1176, i8* %t1177, i64 %t1178)
    %t1179 = load %struct.string**, %struct.string*** %string_struct_array_ptr, align 8
    %t1180 = load i32, i32* %i, align 4
    %t1181 = sext i32 %t1180 to i64
    %t1182 = mul nsw i64 %t1181, 8
    %t1183 = bitcast %struct.string** %t1179 to i8*
    %t1184 = getelementptr i8, i8* %t1183, i64 %t1182
    %t1185 = bitcast i8* %t1184 to %struct.string**
    %target_string_ptr_ptr = alloca %struct.string**, align 8
    store %struct.string** %t1185, %struct.string*** %target_string_ptr_ptr, align 8
    %t1186 = load %struct.string**, %struct.string*** %target_string_ptr_ptr, align 8
    %t1187 = load %struct.string*, %struct.string** %string_struct_ptr, align 8
    store %struct.string* %t1187, %struct.string** %t1186, align 8
    %t1188 = load i32, i32* %i, align 4
    %t1190 = sext i32 %t1188 to i64
    %t1189 = add nsw i64 %t1190, 1
    %t1191 = trunc i64 %t1189 to i32
    store i32 %t1191, i32* %i, align 4
    br label %while.header.17
while.end.19:
  %t1192 = load i32, i32* %p.argc, align 4
  %t1193 = load %struct.array._struct_string*, %struct.array._struct_string** %array_struct_ptr, align 8
  %t1194 = bitcast %struct.array._struct_string* %t1193 to %struct.array._struct_string**
  %t1195 = call i32 @main(i32 %t1192, %struct.array._struct_string** %t1194)
  ret i32 %t1195
}

define i32 @main(i32 %argc, %struct.array._struct_string** %argv_yulang) {
entry:
  %p.argc = alloca i32, align 4
  store i32 %argc, i32* %p.argc, align 4
  %p.argv_yulang = alloca %struct.array._struct_string**, align 8
  store %struct.array._struct_string** %argv_yulang, %struct.array._struct_string*** %p.argv_yulang, align 8
  %t1196 = getelementptr inbounds %struct.module_libs_linux_arm64_std_io, %struct.module_libs_linux_arm64_std_io* @module_libs_linux_arm64_std_io, i32 0, i32 3
  %t1197 = load void (%struct.string)*, void (%struct.string)** %t1196, align 8
  %t1198 = load %struct.string, %struct.string* @.string.2, align 8
  call void %t1197(%struct.string %t1198)
  %t1199 = getelementptr inbounds %struct.module_libs_linux_arm64_std_io, %struct.module_libs_linux_arm64_std_io* @module_libs_linux_arm64_std_io, i32 0, i32 2
  %t1200 = load void (%struct.string)*, void (%struct.string)** %t1199, align 8
  %t1201 = load %struct.string, %struct.string* @.string.3, align 8
  call void %t1200(%struct.string %t1201)
  %t1202 = getelementptr inbounds %struct.module_libs_linux_arm64_std_io, %struct.module_libs_linux_arm64_std_io* @module_libs_linux_arm64_std_io, i32 0, i32 3
  %t1203 = load void (%struct.string)*, void (%struct.string)** %t1202, align 8
  %t1204 = load i32, i32* %p.argc, align 4
  %t1205 = sext i32 %t1204 to i64
  %t1206 = alloca %struct.string*, align 8
  %t1207 = icmp eq i64 %t1205, 0
  br i1 %t1207, label %tostr.iszero.24, label %tostr.notzero.25
tostr.iszero.24:
  %t1208 = call i8* @yulang_malloc(i64 1)
  store i8 48, i8* %t1208, align 1
  %t1209 = alloca %struct.string, align 8
  %t1210 = getelementptr inbounds %struct.string, %struct.string* %t1209, i32 0, i32 0
  store i8* %t1208, i8** %t1210, align 8
  %t1211 = getelementptr inbounds %struct.string, %struct.string* %t1209, i32 0, i32 1
  store i64 1, i64* %t1211, align 8
  store %struct.string* %t1209, %struct.string** %t1206, align 8
  br label %tostr.exit.26
tostr.notzero.25:
  %t1212 = alloca i8, i64 21, align 1
  %t1213 = getelementptr i8, i8* %t1212, i64 21
  %t1214 = alloca i8*, align 8
  store i8* %t1213, i8** %t1214, align 8
  %t1215 = icmp slt i64 %t1205, 0
  %t1217 = sub i64 0, %t1205
  %t1216 = select i1 %t1215, i64 %t1217, i64 %t1205
  %t1218 = alloca i64, align 8
  store i64 %t1216, i64* %t1218, align 8
  br label %tostr.loop.header.27
tostr.loop.header.27:
  %t1219 = load i64, i64* %t1218, align 8
  %t1220 = icmp ne i64 %t1219, 0
  br i1 %t1220, label %tostr.loop.body.28, label %tostr.loop.end.29
tostr.loop.body.28:
  %t1221 = load i8*, i8** %t1214, align 8
  %t1222 = getelementptr i8, i8* %t1221, i64 -1
  store i8* %t1222, i8** %t1214, align 8
  %t1223 = load i64, i64* %t1218, align 8
  %t1224 = srem i64 %t1223, 10
  %t1225 = sdiv i64 %t1223, 10
  store i64 %t1225, i64* %t1218, align 8
  %t1226 = add i64 %t1224, 48
  %t1227 = trunc i64 %t1226 to i8
  store i8 %t1227, i8* %t1222, align 1
  br label %tostr.loop.header.27
tostr.loop.end.29:
  br i1 %t1215, label %tostr.addsign.30, label %tostr.sign.end.31
tostr.addsign.30:
  %t1228 = load i8*, i8** %t1214, align 8
  %t1229 = getelementptr i8, i8* %t1228, i64 -1
  store i8* %t1229, i8** %t1214, align 8
  store i8 45, i8* %t1229, align 1
  br label %tostr.sign.end.31
tostr.sign.end.31:
  %t1230 = load i8*, i8** %t1214, align 8
  %t1232 = ptrtoint i8* %t1213 to i64
  %t1233 = ptrtoint i8* %t1230 to i64
  %t1231 = sub i64 %t1232, %t1233
  %t1234 = call i8* @yulang_malloc(i64 %t1231)
  call void @__memcpy_inline(i8* %t1234, i8* %t1230, i64 %t1231)
  %t1235 = alloca %struct.string, align 8
  %t1236 = getelementptr inbounds %struct.string, %struct.string* %t1235, i32 0, i32 0
  store i8* %t1234, i8** %t1236, align 8
  %t1237 = getelementptr inbounds %struct.string, %struct.string* %t1235, i32 0, i32 1
  store i64 %t1231, i64* %t1237, align 8
  store %struct.string* %t1235, %struct.string** %t1206, align 8
  br label %tostr.exit.26
tostr.exit.26:
  %t1238 = load %struct.string*, %struct.string** %t1206, align 8
  %t1239 = load %struct.string, %struct.string* %t1238, align 8
  call void %t1203(%struct.string %t1239)
  %i = alloca i32, align 4
  store i32 0, i32* %i, align 4
  br label %while.header.32
while.header.32:
    %t1240 = load i32, i32* %i, align 4
    %t1241 = load i32, i32* %p.argc, align 4
    %t1242 = icmp slt i32 %t1240, %t1241
    br i1 %t1242, label %while.body.33, label %while.end.34
while.body.33:
    %t1243 = load %struct.array._struct_string**, %struct.array._struct_string*** %p.argv_yulang, align 8
    %t1244 = bitcast %struct.array._struct_string** %t1243 to %struct.string***
    %array_ptr_to_data_ptr = alloca %struct.string***, align 8
    store %struct.string*** %t1244, %struct.string**** %array_ptr_to_data_ptr, align 8
    %t1245 = load %struct.string***, %struct.string**** %array_ptr_to_data_ptr, align 8
    %t1246 = load %struct.string**, %struct.string*** %t1245, align 8
    %array_data_ptr = alloca %struct.string**, align 8
    store %struct.string** %t1246, %struct.string*** %array_data_ptr, align 8
    %t1247 = load %struct.string**, %struct.string*** %array_data_ptr, align 8
    %t1248 = load i32, i32* %i, align 4
    %t1249 = sext i32 %t1248 to i64
    %t1250 = mul nsw i64 %t1249, 8
    %t1251 = bitcast %struct.string** %t1247 to i8*
    %t1252 = getelementptr i8, i8* %t1251, i64 %t1250
    %t1253 = bitcast i8* %t1252 to %struct.string**
    %current_str_ptr_ptr = alloca %struct.string**, align 8
    store %struct.string** %t1253, %struct.string*** %current_str_ptr_ptr, align 8
    %t1254 = load %struct.string**, %struct.string*** %current_str_ptr_ptr, align 8
    %t1255 = load %struct.string*, %struct.string** %t1254, align 8
    %current_str_ptr = alloca %struct.string*, align 8
    store %struct.string* %t1255, %struct.string** %current_str_ptr, align 8
    %t1256 = getelementptr inbounds %struct.module_libs_linux_arm64_std_io, %struct.module_libs_linux_arm64_std_io* @module_libs_linux_arm64_std_io, i32 0, i32 2
    %t1257 = load void (%struct.string)*, void (%struct.string)** %t1256, align 8
    %t1258 = load %struct.string, %struct.string* @.string.4, align 8
    call void %t1257(%struct.string %t1258)
    %t1259 = getelementptr inbounds %struct.module_libs_linux_arm64_std_io, %struct.module_libs_linux_arm64_std_io* @module_libs_linux_arm64_std_io, i32 0, i32 2
    %t1260 = load void (%struct.string)*, void (%struct.string)** %t1259, align 8
    %t1261 = load i32, i32* %i, align 4
    %t1262 = sext i32 %t1261 to i64
    %t1263 = alloca %struct.string*, align 8
    %t1264 = icmp eq i64 %t1262, 0
    br i1 %t1264, label %tostr.iszero.35, label %tostr.notzero.36
tostr.iszero.35:
    %t1265 = call i8* @yulang_malloc(i64 1)
    store i8 48, i8* %t1265, align 1
    %t1266 = alloca %struct.string, align 8
    %t1267 = getelementptr inbounds %struct.string, %struct.string* %t1266, i32 0, i32 0
    store i8* %t1265, i8** %t1267, align 8
    %t1268 = getelementptr inbounds %struct.string, %struct.string* %t1266, i32 0, i32 1
    store i64 1, i64* %t1268, align 8
    store %struct.string* %t1266, %struct.string** %t1263, align 8
    br label %tostr.exit.37
tostr.notzero.36:
    %t1269 = alloca i8, i64 21, align 1
    %t1270 = getelementptr i8, i8* %t1269, i64 21
    %t1271 = alloca i8*, align 8
    store i8* %t1270, i8** %t1271, align 8
    %t1272 = icmp slt i64 %t1262, 0
    %t1274 = sub i64 0, %t1262
    %t1273 = select i1 %t1272, i64 %t1274, i64 %t1262
    %t1275 = alloca i64, align 8
    store i64 %t1273, i64* %t1275, align 8
    br label %tostr.loop.header.38
tostr.loop.header.38:
    %t1276 = load i64, i64* %t1275, align 8
    %t1277 = icmp ne i64 %t1276, 0
    br i1 %t1277, label %tostr.loop.body.39, label %tostr.loop.end.40
tostr.loop.body.39:
    %t1278 = load i8*, i8** %t1271, align 8
    %t1279 = getelementptr i8, i8* %t1278, i64 -1
    store i8* %t1279, i8** %t1271, align 8
    %t1280 = load i64, i64* %t1275, align 8
    %t1281 = srem i64 %t1280, 10
    %t1282 = sdiv i64 %t1280, 10
    store i64 %t1282, i64* %t1275, align 8
    %t1283 = add i64 %t1281, 48
    %t1284 = trunc i64 %t1283 to i8
    store i8 %t1284, i8* %t1279, align 1
    br label %tostr.loop.header.38
tostr.loop.end.40:
    br i1 %t1272, label %tostr.addsign.41, label %tostr.sign.end.42
tostr.addsign.41:
    %t1285 = load i8*, i8** %t1271, align 8
    %t1286 = getelementptr i8, i8* %t1285, i64 -1
    store i8* %t1286, i8** %t1271, align 8
    store i8 45, i8* %t1286, align 1
    br label %tostr.sign.end.42
tostr.sign.end.42:
    %t1287 = load i8*, i8** %t1271, align 8
    %t1289 = ptrtoint i8* %t1270 to i64
    %t1290 = ptrtoint i8* %t1287 to i64
    %t1288 = sub i64 %t1289, %t1290
    %t1291 = call i8* @yulang_malloc(i64 %t1288)
    call void @__memcpy_inline(i8* %t1291, i8* %t1287, i64 %t1288)
    %t1292 = alloca %struct.string, align 8
    %t1293 = getelementptr inbounds %struct.string, %struct.string* %t1292, i32 0, i32 0
    store i8* %t1291, i8** %t1293, align 8
    %t1294 = getelementptr inbounds %struct.string, %struct.string* %t1292, i32 0, i32 1
    store i64 %t1288, i64* %t1294, align 8
    store %struct.string* %t1292, %struct.string** %t1263, align 8
    br label %tostr.exit.37
tostr.exit.37:
    %t1295 = load %struct.string*, %struct.string** %t1263, align 8
    %t1296 = load %struct.string, %struct.string* %t1295, align 8
    call void %t1260(%struct.string %t1296)
    %t1297 = getelementptr inbounds %struct.module_libs_linux_arm64_std_io, %struct.module_libs_linux_arm64_std_io* @module_libs_linux_arm64_std_io, i32 0, i32 2
    %t1298 = load void (%struct.string)*, void (%struct.string)** %t1297, align 8
    %t1299 = load %struct.string, %struct.string* @.string.5, align 8
    call void %t1298(%struct.string %t1299)
    %t1300 = load %struct.string*, %struct.string** %current_str_ptr, align 8
    %t1301 = load %struct.string, %struct.string* %t1300, align 8
    %current_str_value = alloca %struct.string, align 8
    store %struct.string %t1301, %struct.string* %current_str_value, align 8
    %t1302 = getelementptr inbounds %struct.module_libs_linux_arm64_std_io, %struct.module_libs_linux_arm64_std_io* @module_libs_linux_arm64_std_io, i32 0, i32 3
    %t1303 = load void (%struct.string)*, void (%struct.string)** %t1302, align 8
    %t1304 = load %struct.string, %struct.string* %current_str_value, align 8
    call void %t1303(%struct.string %t1304)
    %t1305 = load i32, i32* %i, align 4
    %t1307 = sext i32 %t1305 to i64
    %t1306 = add nsw i64 %t1307, 1
    %t1308 = trunc i64 %t1306 to i32
    store i32 %t1308, i32* %i, align 4
    br label %while.header.32
while.end.34:
  %t1309 = getelementptr inbounds %struct.module_libs_linux_arm64_std_io, %struct.module_libs_linux_arm64_std_io* @module_libs_linux_arm64_std_io, i32 0, i32 3
  %t1310 = load void (%struct.string)*, void (%struct.string)** %t1309, align 8
  %t1311 = load %struct.string, %struct.string* @.string.6, align 8
  call void %t1310(%struct.string %t1311)
  %t1312 = trunc i64 0 to i32
  ret i32 %t1312
}


declare i8* @_prog_yulang_malloc(i64)
declare void @_prog_memcpy(i8*, i8*, i64)
@.str.0 = private unnamed_addr constant [1 x i8] c"\00", align 1
@.string.0 = private unnamed_addr constant %struct.string { i8* getelementptr inbounds ([1 x i8], [1 x i8]* @.str.0, i64 0, i64 0), i64 0}, align 8
@.str.1 = private unnamed_addr constant [2 x i8] c"\0A\00", align 1
@.string.1 = private unnamed_addr constant %struct.string { i8* getelementptr inbounds ([2 x i8], [2 x i8]* @.str.1, i64 0, i64 0), i64 1}, align 8
@.str.2 = private unnamed_addr constant [24 x i8] c"--- 命令行参数 ---\00", align 1
@.string.2 = private unnamed_addr constant %struct.string { i8* getelementptr inbounds ([24 x i8], [24 x i8]* @.str.2, i64 0, i64 0), i64 23}, align 8
@.str.3 = private unnamed_addr constant [22 x i8] c"参数数量 (argc): \00", align 1
@.string.3 = private unnamed_addr constant %struct.string { i8* getelementptr inbounds ([22 x i8], [22 x i8]* @.str.3, i64 0, i64 0), i64 21}, align 8
@.str.4 = private unnamed_addr constant [13 x i8] c"argv_yulang[\00", align 1
@.string.4 = private unnamed_addr constant %struct.string { i8* getelementptr inbounds ([13 x i8], [13 x i8]* @.str.4, i64 0, i64 0), i64 12}, align 8
@.str.5 = private unnamed_addr constant [4 x i8] c"]: \00", align 1
@.string.5 = private unnamed_addr constant %struct.string { i8* getelementptr inbounds ([4 x i8], [4 x i8]* @.str.5, i64 0, i64 0), i64 3}, align 8
@.str.6 = private unnamed_addr constant [21 x i8] c"--- 参数结束 ---\00", align 1
@.string.6 = private unnamed_addr constant %struct.string { i8* getelementptr inbounds ([21 x i8], [21 x i8]* @.str.6, i64 0, i64 0), i64 20}, align 8
#ifndef YU_RUNTIME_H
#define YU_RUNTIME_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

// Garbage collection
extern void* GC_malloc(size_t size);
extern void* GC_realloc(void* ptr, size_t size);
extern void GC_init(void);

// Runtime initialization
void yu_uv_init(void);
int32_t yu_uv_run(void);

// Basic types
typedef struct {
    char *ptr;
    int64_t length;
} yu_string;

typedef struct {
    void *ptr;
    int64_t length;
    int64_t capacity;
} yu_array;

typedef struct {
    void *value;
    int32_t resolved;
} yu_promise;

// Runtime functions
int32_t yu_fs_readFile(yu_string path, void *code, void *env);
yu_string yu_uv_readFileSync(yu_string path);
int32_t yu_uv_writeFileSync(yu_string path, yu_string data);
int32_t yu_uv_appendFileSync(yu_string path, yu_string data);
int32_t yu_uv_accessSync(yu_string path, int32_t mode);
int32_t yu_uv_unlinkSync(yu_string path);
int32_t yu_uv_renameSync(yu_string old_path, yu_string new_path);
int32_t yu_uv_mkdirSync(yu_string path, int32_t mode);
int32_t yu_uv_rmdirSync(yu_string path);

int64_t yu_uv_tcpCreateServer(void *code, void *env);
int32_t yu_uv_tcpListen(int64_t server_handle, int32_t port, yu_string host, int32_t backlog, void *code, void *env);
int64_t yu_uv_tcpConnect(int32_t port, yu_string host, void *code, void *env);
int32_t yu_uv_tcpReadStart(int64_t socket_handle, void *code, void *env);
int32_t yu_uv_tcpWrite(int64_t socket_handle, yu_string data, void *code, void *env);
int32_t yu_uv_tcpShutdown(int64_t socket_handle, void *code, void *env);
int32_t yu_uv_tcpClose(int64_t handle);

#ifdef __cplusplus
}
#endif

#endif // YU_RUNTIME_H

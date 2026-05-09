#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>

typedef struct {
    char *ptr;
    int64_t length;
} yu_string;

typedef struct {
    yu_string value;
    int resolved;
} yu_string_promise;

typedef void (*yu_read_file_cb)(void *env, int32_t err, yu_string data);
typedef void (*yu_net_connection_cb)(void *env, int64_t socket_handle);
typedef void (*yu_net_data_cb)(void *env, int32_t err, yu_string data);
typedef void (*yu_net_status_cb)(void *env, int32_t status);

typedef struct {
    yu_string_promise *promise;
} yu_read_sync_ctx;

typedef struct yu_read_file_req {
    uv_fs_t open_req;
    uv_fs_t stat_req;
    uv_fs_t read_req;
    uv_fs_t close_req;
    uv_buf_t buf;
    uv_file file;
    yu_read_file_cb cb;
    void *env;
    char *path;
    char *data;
    int64_t length;
    int32_t err;
} yu_read_file_req;

typedef struct yu_tcp_socket {
    uv_tcp_t handle;
    yu_net_data_cb data_cb;
    void *data_env;
    yu_net_status_cb end_cb;
    void *end_env;
} yu_tcp_socket;

typedef struct yu_tcp_server {
    uv_tcp_t handle;
    yu_net_connection_cb connection_cb;
    void *connection_env;
    yu_net_status_cb listen_cb;
    void *listen_env;
} yu_tcp_server;

typedef struct {
    uv_connect_t req;
    yu_tcp_socket *socket;
    yu_net_status_cb cb;
    void *env;
} yu_tcp_connect_req;

typedef struct {
    uv_write_t req;
    uv_buf_t buf;
    char *data;
    yu_net_status_cb cb;
    void *env;
} yu_tcp_write_req;

typedef struct {
    uv_shutdown_t req;
    yu_net_status_cb cb;
    void *env;
} yu_tcp_shutdown_req;

extern void *GC_malloc(size_t size);

static char yu_empty_string[] = "";

static yu_string yu_gc_string_from_cstr(const char *data) {
    if (!data) {
        yu_string result = { yu_empty_string, 0 };
        return result;
    }
    size_t length = strlen(data);
    char *gc_data = (char *)GC_malloc(length + 1);
    memcpy(gc_data, data, length + 1);
    yu_string result;
    result.ptr = gc_data;
    result.length = (int64_t)length;
    return result;
}

yu_string yu_string_from_int64(int64_t value) {
    char buffer[32];
    snprintf(buffer, sizeof(buffer), "%lld", (long long)value);
    return yu_gc_string_from_cstr(buffer);
}

yu_string yu_string_from_uint64(uint64_t value) {
    char buffer[32];
    snprintf(buffer, sizeof(buffer), "%llu", (unsigned long long)value);
    return yu_gc_string_from_cstr(buffer);
}

yu_string yu_string_from_double(double value) {
    char buffer[64];
    snprintf(buffer, sizeof(buffer), "%.17g", value);
    return yu_gc_string_from_cstr(buffer);
}

void *yu_promise_store_string(yu_string value) {
    yu_string *boxed = (yu_string *)GC_malloc(sizeof(yu_string));
    *boxed = value;
    return boxed;
}

yu_string yu_promise_load_string(void *value) {
    return value ? *(yu_string *)value : (yu_string){ yu_empty_string, 0 };
}

void *yu_promise_store_i32(int32_t value) {
    return (void *)(intptr_t)value;
}

int32_t yu_promise_load_i32(void *value) {
    return (int32_t)(intptr_t)value;
}

void *yu_promise_store_i64(int64_t value) {
    int64_t *boxed = (int64_t *)GC_malloc(sizeof(int64_t));
    *boxed = value;
    return boxed;
}

int64_t yu_promise_load_i64(void *value) {
    return value ? *(int64_t *)value : 0;
}

void *yu_promise_store_bool(int32_t value) {
    return (void *)(intptr_t)value;
}

int32_t yu_promise_load_bool(void *value) {
    return (int32_t)(intptr_t)value;
}

void yu_uv_init(void) {
    uv_default_loop();
}

int32_t yu_uv_run(void) {
    return uv_run(uv_default_loop(), UV_RUN_DEFAULT);
}

static yu_string yu_gc_string_from_owned(char *data, int64_t length, int32_t err) {
    yu_string result;
    if (err == 0 && data) {
        char *gc_data = (char *)GC_malloc((size_t)length + 1);
        memcpy(gc_data, data, (size_t)length + 1);
        result.ptr = gc_data;
        result.length = length;
    } else {
        result.ptr = yu_empty_string;
        result.length = 0;
    }
    return result;
}

static void yu_fs_finish(yu_read_file_req *req) {
    yu_string data = yu_gc_string_from_owned(req->data, req->length, req->err);
    if (req->cb) {
        req->cb(req->env, req->err, data);
    }
    free(req->data);
    free(req->path);
    free(req);
}

static void yu_on_close(uv_fs_t *close_req) {
    yu_read_file_req *req = (yu_read_file_req *)close_req->data;
    uv_fs_req_cleanup(close_req);
    yu_fs_finish(req);
}

static void yu_close_after_error(yu_read_file_req *req) {
    req->close_req.data = req;
    uv_fs_close(uv_default_loop(), &req->close_req, req->file, yu_on_close);
}

static void yu_on_read(uv_fs_t *read_req) {
    yu_read_file_req *req = (yu_read_file_req *)read_req->data;
    if (read_req->result < 0) {
        req->err = (int32_t)read_req->result;
        req->length = 0;
    } else {
        req->length = (int64_t)read_req->result;
        req->data[req->length] = '\0';
        req->err = 0;
    }
    uv_fs_req_cleanup(read_req);
    yu_close_after_error(req);
}

static void yu_on_fstat(uv_fs_t *stat_req) {
    yu_read_file_req *req = (yu_read_file_req *)stat_req->data;
    if (stat_req->result < 0) {
        req->err = (int32_t)stat_req->result;
        uv_fs_req_cleanup(stat_req);
        yu_close_after_error(req);
        return;
    }

    int64_t size = (int64_t)stat_req->statbuf.st_size;
    if (size < 0) size = 0;
    req->data = (char *)malloc((size_t)size + 1);
    if (!req->data) {
        req->err = -ENOMEM;
        uv_fs_req_cleanup(stat_req);
        yu_close_after_error(req);
        return;
    }

    req->buf = uv_buf_init(req->data, (unsigned int)size);
    req->read_req.data = req;
    uv_fs_req_cleanup(stat_req);
    int rc = uv_fs_read(uv_default_loop(), &req->read_req, req->file, &req->buf, 1, 0, yu_on_read);
    if (rc < 0) {
        req->err = rc;
        yu_close_after_error(req);
    }
}

static void yu_on_open(uv_fs_t *open_req) {
    yu_read_file_req *req = (yu_read_file_req *)open_req->data;
    if (open_req->result < 0) {
        req->err = (int32_t)open_req->result;
        uv_fs_req_cleanup(open_req);
        yu_fs_finish(req);
        return;
    }

    req->file = (uv_file)open_req->result;
    uv_fs_req_cleanup(open_req);
    req->stat_req.data = req;
    int rc = uv_fs_fstat(uv_default_loop(), &req->stat_req, req->file, yu_on_fstat);
    if (rc < 0) {
        req->err = rc;
        yu_close_after_error(req);
    }
}

int32_t yu_fs_readFile(yu_string path, void *code, void *env) {
    if (!path.ptr || !code) {
        return -EINVAL;
    }

    yu_read_file_req *req = (yu_read_file_req *)calloc(1, sizeof(yu_read_file_req));
    if (!req) return -ENOMEM;

    req->path = (char *)malloc((size_t)path.length + 1);
    if (!req->path) {
        free(req);
        return -ENOMEM;
    }
    memcpy(req->path, path.ptr, (size_t)path.length);
    req->path[path.length] = '\0';
    req->cb = (yu_read_file_cb)code;
    req->env = env;
    req->open_req.data = req;

    int rc = uv_fs_open(uv_default_loop(), &req->open_req, req->path, O_RDONLY, 0, yu_on_open);
    if (rc < 0) {
        free(req->path);
        free(req);
        return rc;
    }
    return 0;
}

static int32_t yu_write_file_sync(yu_string path, yu_string data, const char *mode) {
    char *path_buf = (char *)malloc((size_t)path.length + 1);
    if (!path_buf) return -ENOMEM;
    memcpy(path_buf, path.ptr, (size_t)path.length);
    path_buf[path.length] = '\0';

    uv_fs_t open_req;
    int flags = O_WRONLY | O_CREAT;
    if (mode[0] == 'a') flags |= O_APPEND;
    else flags |= O_TRUNC;

    int rc = uv_fs_open(uv_default_loop(), &open_req, path_buf, flags, 0666, NULL);
    uv_fs_req_cleanup(&open_req);
    free(path_buf);
    if (rc < 0) return rc;

    uv_file file = (uv_file)rc;
    uv_buf_t buf = uv_buf_init(data.ptr, (unsigned int)data.length);
    uv_fs_t write_req;
    rc = uv_fs_write(uv_default_loop(), &write_req, file, &buf, 1, -1, NULL);
    uv_fs_req_cleanup(&write_req);

    uv_fs_t close_req;
    int close_rc = uv_fs_close(uv_default_loop(), &close_req, file, NULL);
    uv_fs_req_cleanup(&close_req);

    if (rc < 0) return rc;
    if (close_rc < 0) return close_rc;
    return rc;
}

static void yu_read_sync_cb(void *env, int32_t err, yu_string data) {
    yu_read_sync_ctx *ctx = (yu_read_sync_ctx *)env;
    ctx->promise->value = err == 0 ? data : (yu_string){ yu_empty_string, 0 };
    ctx->promise->resolved = 1;
}

yu_string yu_uv_readFileSync(yu_string path) {
    yu_string_promise promise;
    promise.value.ptr = yu_empty_string;
    promise.value.length = 0;
    promise.resolved = 0;

    yu_read_sync_ctx ctx;
    ctx.promise = &promise;
    int rc = yu_fs_readFile(path, (void *)yu_read_sync_cb, &ctx);
    if (rc < 0) {
        promise.resolved = 1;
    } else {
        while (!promise.resolved) {
            uv_run(uv_default_loop(), UV_RUN_DEFAULT);
        }
    }
    return promise.value;
}

int32_t yu_uv_writeFileSync(yu_string path, yu_string data) {
    return yu_write_file_sync(path, data, "w");
}

int32_t yu_uv_appendFileSync(yu_string path, yu_string data) {
    return yu_write_file_sync(path, data, "a");
}

static char *yu_c_path_from_string(yu_string path) {
    char *path_buf = (char *)malloc((size_t)path.length + 1);
    if (!path_buf) return NULL;
    memcpy(path_buf, path.ptr, (size_t)path.length);
    path_buf[path.length] = '\0';
    return path_buf;
}

int32_t yu_uv_accessSync(yu_string path, int32_t mode) {
    char *path_buf = yu_c_path_from_string(path);
    if (!path_buf) return -ENOMEM;
    uv_fs_t req;
    int rc = uv_fs_access(uv_default_loop(), &req, path_buf, mode, NULL);
    uv_fs_req_cleanup(&req);
    free(path_buf);
    return rc;
}

int32_t yu_uv_unlinkSync(yu_string path) {
    char *path_buf = yu_c_path_from_string(path);
    if (!path_buf) return -ENOMEM;
    uv_fs_t req;
    int rc = uv_fs_unlink(uv_default_loop(), &req, path_buf, NULL);
    uv_fs_req_cleanup(&req);
    free(path_buf);
    return rc;
}

int32_t yu_uv_renameSync(yu_string old_path, yu_string new_path) {
    char *old_buf = yu_c_path_from_string(old_path);
    char *new_buf = yu_c_path_from_string(new_path);
    if (!old_buf || !new_buf) {
        free(old_buf);
        free(new_buf);
        return -ENOMEM;
    }
    uv_fs_t req;
    int rc = uv_fs_rename(uv_default_loop(), &req, old_buf, new_buf, NULL);
    uv_fs_req_cleanup(&req);
    free(old_buf);
    free(new_buf);
    return rc;
}

int32_t yu_uv_mkdirSync(yu_string path, int32_t mode) {
    char *path_buf = yu_c_path_from_string(path);
    if (!path_buf) return -ENOMEM;
    uv_fs_t req;
    int rc = uv_fs_mkdir(uv_default_loop(), &req, path_buf, mode, NULL);
    uv_fs_req_cleanup(&req);
    free(path_buf);
    return rc;
}

int32_t yu_uv_rmdirSync(yu_string path) {
    char *path_buf = yu_c_path_from_string(path);
    if (!path_buf) return -ENOMEM;
    uv_fs_t req;
    int rc = uv_fs_rmdir(uv_default_loop(), &req, path_buf, NULL);
    uv_fs_req_cleanup(&req);
    free(path_buf);
    return rc;
}

static yu_string yu_gc_string_from_buf(const char *data, int64_t length) {
    yu_string result;
    if (data && length > 0) {
        char *gc_data = (char *)GC_malloc((size_t)length + 1);
        memcpy(gc_data, data, (size_t)length);
        gc_data[length] = '\0';
        result.ptr = gc_data;
        result.length = length;
    } else {
        result.ptr = yu_empty_string;
        result.length = 0;
    }
    return result;
}

static void yu_net_alloc_cb(uv_handle_t *handle, size_t suggested_size, uv_buf_t *buf) {
    (void)handle;
    buf->base = (char *)malloc(suggested_size);
    buf->len = suggested_size;
}

static void yu_net_read_cb(uv_stream_t *stream, ssize_t nread, const uv_buf_t *buf) {
    yu_tcp_socket *socket = (yu_tcp_socket *)stream->data;
    if (nread > 0) {
        if (socket && socket->data_cb) {
            yu_string data = yu_gc_string_from_buf(buf->base, (int64_t)nread);
            socket->data_cb(socket->data_env, 0, data);
        }
    } else if (nread < 0) {
        uv_read_stop(stream);
        if (socket && socket->data_cb && nread != UV_EOF) {
            socket->data_cb(socket->data_env, (int32_t)nread, (yu_string){ yu_empty_string, 0 });
        }
        if (socket && socket->end_cb) {
            socket->end_cb(socket->end_env, (int32_t)nread);
        }
    }
    if (buf->base) free(buf->base);
}

static void yu_net_on_connection(uv_stream_t *server_stream, int status) {
    yu_tcp_server *server = (yu_tcp_server *)server_stream->data;
    if (!server || status < 0) {
        if (server && server->listen_cb) server->listen_cb(server->listen_env, status);
        return;
    }

    yu_tcp_socket *client = (yu_tcp_socket *)GC_malloc(sizeof(yu_tcp_socket));
    memset(client, 0, sizeof(yu_tcp_socket));
    int rc = uv_tcp_init(uv_default_loop(), &client->handle);
    if (rc < 0) {
        if (server->listen_cb) server->listen_cb(server->listen_env, rc);
        return;
    }
    client->handle.data = client;

    rc = uv_accept(server_stream, (uv_stream_t *)&client->handle);
    if (rc < 0) {
        uv_close((uv_handle_t *)&client->handle, NULL);
        if (server->listen_cb) server->listen_cb(server->listen_env, rc);
        return;
    }

    if (server->connection_cb) {
        server->connection_cb(server->connection_env, (int64_t)(intptr_t)client);
    }
}

static void yu_net_on_connect(uv_connect_t *connect_req, int status) {
    yu_tcp_connect_req *ctx = (yu_tcp_connect_req *)connect_req->data;
    if (ctx && ctx->cb) ctx->cb(ctx->env, status);
}

static char *yu_owned_c_path(yu_string value) {
    char *buffer = (char *)malloc((size_t)value.length + 1);
    if (!buffer) return NULL;
    memcpy(buffer, value.ptr, (size_t)value.length);
    buffer[value.length] = '\0';
    return buffer;
}

int64_t yu_uv_tcpCreateServer(void *code, void *env) {
    yu_tcp_server *server = (yu_tcp_server *)GC_malloc(sizeof(yu_tcp_server));
    memset(server, 0, sizeof(yu_tcp_server));
    int rc = uv_tcp_init(uv_default_loop(), &server->handle);
    if (rc < 0) return rc;
    server->connection_cb = (yu_net_connection_cb)code;
    server->connection_env = env;
    server->handle.data = server;
    return (int64_t)(intptr_t)server;
}

int32_t yu_uv_tcpListen(int64_t server_handle, int32_t port, yu_string host, int32_t backlog, void *code, void *env) {
    yu_tcp_server *server = (yu_tcp_server *)(intptr_t)server_handle;
    if (!server) return -EINVAL;

    char *host_buf = yu_owned_c_path(host);
    if (!host_buf) return -ENOMEM;

    struct sockaddr_in addr;
    int rc = uv_ip4_addr(host_buf, port, &addr);
    free(host_buf);
    if (rc < 0) return rc;

    rc = uv_tcp_bind(&server->handle, (const struct sockaddr *)&addr, 0);
    if (rc < 0) return rc;

    server->listen_cb = (yu_net_status_cb)code;
    server->listen_env = env;
    rc = uv_listen((uv_stream_t *)&server->handle, backlog, yu_net_on_connection);
    if (rc == 0 && server->listen_cb) {
        server->listen_cb(server->listen_env, 0);
    }
    return rc;
}

int64_t yu_uv_tcpConnect(int32_t port, yu_string host, void *code, void *env) {
    yu_tcp_socket *socket = (yu_tcp_socket *)GC_malloc(sizeof(yu_tcp_socket));
    memset(socket, 0, sizeof(yu_tcp_socket));
    int rc = uv_tcp_init(uv_default_loop(), &socket->handle);
    if (rc < 0) return rc;
    socket->handle.data = socket;

    char *host_buf = yu_owned_c_path(host);
    if (!host_buf) return -ENOMEM;

    struct sockaddr_in addr;
    rc = uv_ip4_addr(host_buf, port, &addr);
    free(host_buf);
    if (rc < 0) return rc;

    yu_tcp_connect_req *req = (yu_tcp_connect_req *)GC_malloc(sizeof(yu_tcp_connect_req));
    memset(req, 0, sizeof(yu_tcp_connect_req));
    req->socket = socket;
    req->cb = (yu_net_status_cb)code;
    req->env = env;
    req->req.data = req;
    rc = uv_tcp_connect(&req->req, &socket->handle, (const struct sockaddr *)&addr, yu_net_on_connect);
    if (rc < 0) return rc;
    return (int64_t)(intptr_t)socket;
}

int32_t yu_uv_tcpReadStart(int64_t socket_handle, void *code, void *env) {
    yu_tcp_socket *socket = (yu_tcp_socket *)(intptr_t)socket_handle;
    if (!socket) return -EINVAL;
    socket->data_cb = (yu_net_data_cb)code;
    socket->data_env = env;
    return uv_read_start((uv_stream_t *)&socket->handle, yu_net_alloc_cb, yu_net_read_cb);
}

static void yu_net_write_done(uv_write_t *write_req, int status) {
    yu_tcp_write_req *req = (yu_tcp_write_req *)write_req->data;
    if (req && req->cb) req->cb(req->env, status);
    if (req) free(req->data);
}

int32_t yu_uv_tcpWrite(int64_t socket_handle, yu_string data, void *code, void *env) {
    yu_tcp_socket *socket = (yu_tcp_socket *)(intptr_t)socket_handle;
    if (!socket) return -EINVAL;

    yu_tcp_write_req *req = (yu_tcp_write_req *)GC_malloc(sizeof(yu_tcp_write_req));
    memset(req, 0, sizeof(yu_tcp_write_req));
    req->data = (char *)malloc((size_t)data.length);
    if (!req->data && data.length > 0) return -ENOMEM;
    memcpy(req->data, data.ptr, (size_t)data.length);
    req->buf = uv_buf_init(req->data, (unsigned int)data.length);
    req->cb = (yu_net_status_cb)code;
    req->env = env;
    req->req.data = req;
    return uv_write(&req->req, (uv_stream_t *)&socket->handle, &req->buf, 1, yu_net_write_done);
}

static void yu_net_shutdown_done(uv_shutdown_t *shutdown_req, int status) {
    yu_tcp_shutdown_req *req = (yu_tcp_shutdown_req *)shutdown_req->data;
    if (req && req->cb) req->cb(req->env, status);
}

int32_t yu_uv_tcpShutdown(int64_t socket_handle, void *code, void *env) {
    yu_tcp_socket *socket = (yu_tcp_socket *)(intptr_t)socket_handle;
    if (!socket) return -EINVAL;
    yu_tcp_shutdown_req *req = (yu_tcp_shutdown_req *)GC_malloc(sizeof(yu_tcp_shutdown_req));
    memset(req, 0, sizeof(yu_tcp_shutdown_req));
    req->cb = (yu_net_status_cb)code;
    req->env = env;
    req->req.data = req;
    return uv_shutdown(&req->req, (uv_stream_t *)&socket->handle, yu_net_shutdown_done);
}

int32_t yu_uv_tcpClose(int64_t handle) {
    uv_handle_t *uv_handle = (uv_handle_t *)(intptr_t)handle;
    if (!uv_handle) return -EINVAL;
    if (!uv_is_closing(uv_handle)) uv_close(uv_handle, NULL);
    return 0;
}

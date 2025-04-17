const MIRROR_URL = 'https://christianai.pages.dev';

const createResponse = (data, status = 200, contentType = 'application/json') => {
    const body = contentType === 'application/json' ? JSON.stringify(data) : data;
    return new Response(body, {
        status,
        headers: {
            'Content-Type': `${contentType}; charset=utf-8`,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
    });
};

const handleError = (message, status = 500) => {
    return createResponse({ code: status, message }, status);
};

const routeHandlers = {

    async github(request, url) {
        try {
            const githubPath = url.pathname.replace('/github/', '');
            const githubUrl = `https://api.github.com/${githubPath}`;
            const headers = new Headers(request.headers);
            headers.set('User-Agent', 'Cloudflare-Worker');

            const githubResponse = await fetch(githubUrl, {
                method: request.method,
                headers,
                body: request.method !== 'GET' ? await request.text() : undefined
            });

            return new Response(await githubResponse.text(), {
                status: githubResponse.status,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                    'Content-Type': 'application/json'
                }
            });
        } catch (error) {
            return handleError('GitHub API 请求失败: ' + error.message);
        }
    },

    async gist(request, url, env) {
        if (!await validateToken(url, env)) {
            return handleError('未授权访问', 401);
        }

        try {
            const key = url.searchParams.get('key');
            const timestamp = Date.now();
            const gistUrl = `https://gist.githubusercontent.com/${env.GITHUB_USER}/${env.GITHUB_ID}/raw/${key}?timestamp=${timestamp}`;
            const gistContent = await fetch(gistUrl).then(res => res.text());
            return createResponse(gistContent, 200, 'text/plain');
        } catch (error) {
            return handleError('获取 Gist 内容失败: ' + error.message);
        }
    },

    async sub(request, url, env) {
        try {
            const key = url.searchParams.get('key') || 'sub';
            const timestamp = Date.now();
            const gistUrl = `https://gist.githubusercontent.com/${env.GITHUB_USER}/${env.GITHUB_ID}/raw/${key}?token=${env.AUTH_TOKEN}&timestamp=${timestamp}`;
            const gistContent = await fetch(gistUrl).then(res => res.text());
            return createResponse(gistContent, 200, 'text/plain');
        } catch (error) {
            return handleError('获取 Sub 内容失败: ' + error.message);
        }
    },

    async storage(request, url, env) {
        if (!await validateToken(url, env)) {
            return handleError('未授权访问', 401);
        }

        if (request.method === 'GET') {
            const filename = url.searchParams.get('filename');
            if (!filename) {
                return handleError('请提供文件名', 400);
            }

            try {
                const object = await env.SUB_BUCKET.get(filename);
                if (object === null) {
                    return handleError('未找到该键对应的值', 404);
                }
                return createResponse(await object.text(), 200, 'text/plain');
            } catch (error) {
                return handleError('读取数据失败: ' + error.message);
            }
        } else if (request.method === 'POST') {
            try {
                const { filename, value } = await request.json();
                if (!filename || !value) {
                    return handleError('请提供文件名和值', 400);
                }

                await env.SUB_BUCKET.put(filename, value);
                return createResponse({ code: 200, message: '数据写入成功' });
            } catch (error) {
                return handleError('数据写入失败: ' + error.message);
            }
        }

        return handleError('不支持的请求方法', 405);
    },
    async speedtest(request, url, env) {
        try {
            const bytes = url.searchParams.get('bytes');
            if (!bytes) {
                return handleError('请提供测试大小(bytes)', 400);
            }

            const speedTestUrl = `https://speed.cloudflare.com/__down?bytes=${bytes}`;
            const response = await fetch(speedTestUrl, {
                method: request.method,
                headers: request.headers
            });

            return new Response(response.body, {
                status: response.status,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Content-Type': 'application/octet-stream'
                }
            });
        } catch (error) {
            return handleError('测速失败: ' + error.message);
        }
    },
    async raw(request, url) {
        try {
            // 从 pathname 中提取 /raw 后的部分
            const inputPath = url.pathname.replace('/raw', '');
            if (!inputPath || inputPath == '/') {
                return handleError('请提供 GitHub 相关路径', 400);
            }
    
            let targetUrl;
            // 判断是否包含域名部分
            if (inputPath.includes('raw.githubusercontent.com')) {
                // 提取 raw.githubusercontent.com 后的路径
                const rawIndex = inputPath.indexOf('raw.githubusercontent.com');
                const githubPath = inputPath.substring(rawIndex + 'raw.githubusercontent.com'.length);
                targetUrl = `https://raw.githubusercontent.com${githubPath}`;
            } else if (inputPath.includes('github.com')) {
                // 提取 github.com 后的路径（release 或 archive）
                const githubIndex = inputPath.indexOf('github.com');
                const githubPath = inputPath.substring(githubIndex + 'github.com'.length);
                if (githubPath.includes('/releases/download/') || githubPath.includes('/archive/')) {
                    targetUrl = `https://github.com${githubPath}`;
                } else {
                    return handleError('仅支持 raw 文件、release 或 archive 路径', 400);
                }
            } else {
                // 不含域名，假设是 raw 文件路径或 release/archive 路径
                const path = inputPath.startsWith('/') ? inputPath : `/${inputPath}`;
                if (path.includes('/releases/download/') || path.includes('/archive/')) {
                    targetUrl = `https://github.com${path}`;
                } else {
                    targetUrl = `https://raw.githubusercontent.com${path}`;
                }
            }
    
            // 设置请求头
            const headers = new Headers(request.headers);
            headers.set('User-Agent', 'Cloudflare-Worker');
    
            // 通过 Cloudflare 代理下载
            const response = await fetch(targetUrl, {
                method: 'GET',
                headers
            });
    
            if (!response.ok) {
                return handleError('GitHub 下载失败', response.status);
            }
    
            const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
            return new Response(response.body, {
                status: response.status,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Content-Type': contentType
                }
            });
        } catch (error) {
            return handleError('GitHub 代理失败: ' + error.message);
        }
    },
    async dynamicGist(request, url, env, gistId) {
        try {
            const key = url.searchParams.get('key') || 'sub';
            const timestamp = Date.now();
            const gistUrl = `https://gist.githubusercontent.com/${env.GITHUB_USER}/${gistId}/raw/${key}?token=${env.AUTH_TOKEN}&timestamp=${timestamp}`;
            const gistContent = await fetch(gistUrl).then(res => res.text());
            return createResponse(gistContent, 200, 'text/plain');
        } catch (error) {
            return handleError('获取动态Gist内容失败: ' + error.message);
        }
    }
};

async function validateToken(url, env) {
    const token = url.searchParams.get('token');
    return token === env.AUTH_TOKEN;
}

async function handleMirrorRequest(request, url) {
    try {
        const clockieUrl = new URL(url.pathname + url.search, MIRROR_URL);
        const response = await fetch(clockieUrl.toString(), {
            method: request.method,
            headers: request.headers,
            body: request.method !== 'GET' ? await request.clone().text() : undefined
        });

        const responseHeaders = new Headers(response.headers);
        responseHeaders.set('Access-Control-Allow-Origin', '*');

        return new Response(await response.text(), {
            status: response.status,
            headers: responseHeaders
        });
    } catch (error) {
        return handleError('镜像请求失败: ' + error.message);
    }
}

export default {
    async fetch(request, env) {
        try {
            const url = new URL(request.url);
            const pathname = url.pathname;

            // 原有路由配置
            const routes = {
                '/github/': () => routeHandlers.github(request, url),
                '/gist': () => routeHandlers.gist(request, url, env),
                '/sub': () => routeHandlers.sub(request, url, env),
                '/storage': () => routeHandlers.storage(request, url, env),
                '/speedtest': () => routeHandlers.speedtest(request, url, env),
                '/raw': () => routeHandlers.raw(request, url)
            };

            // 优先匹配预设路由
            for (const [route, handler] of Object.entries(routes)) {
                if (pathname === route || pathname.startsWith(route)) {
                    return await handler();
                }
            }

            // 动态Gist路由匹配 (格式: /32位hex字符)
            const potentialGistId = pathname.replace(/^\//, ''); // 移除路径开头的斜杠
            if (/^[0-9a-f]{32}$/i.test(potentialGistId)) {
                return await routeHandlers.dynamicGist(request, url, env, potentialGistId);
            }

            // 未匹配到任何路由时走镜像代理
            return await handleMirrorRequest(request, url);
        } catch (error) {
            return handleError('服务器错误: ' + error.message);
        }
    }
};

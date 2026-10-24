// ==========================================
// Surge — TestFlight 空位监控
// 配套模块：TF-Monitor.sgmodule
//
// 功能：
// 1. 自动获取应用名称
// 2. 通知显示应用名和完整邀请链接
// 3. 点击通知打开对应 TestFlight 邀请
// 4. 去重、测试通知、一次性重置记录
// 5. 支持监控时间段
//
// 常用参数在模块参数界面修改。
// ==========================================


// ---------- 读取模块参数 ----------

const params = {};

String(
    typeof $argument === "string" ? $argument : ""
).split("&").forEach(part => {
    const index = part.indexOf("=");

    if (index >= 0) {
        params[part.slice(0, index)] =
            part.slice(index + 1).trim();
    }
});

function getBoolean(name, fallback) {
    const value = params[name];

    if (value === undefined) return fallback;

    if (!/^(true|false)$/i.test(value)) {
        throw new Error(`${name} 必须填 true 或 false`);
    }

    return value.toLowerCase() === "true";
}

function getHour(name, fallback) {
    const value = params[name] === undefined
        ? String(fallback)
        : params[name];

    if (!/^\d{1,2}$/.test(value) || Number(value) > 23) {
        throw new Error(`${name} 必须填 0—23`);
    }

    return Number(value);
}


// ---------- 持久化记录 ----------

function stateKey(id) {
    return `tf-monitor-state-${id}`;
}

function resetKey(id) {
    return `tf-monitor-reset-token-${id}`;
}

function nameKey(id) {
    return `tf-monitor-name-${id}`;
}


// ---------- 文字处理 ----------

function decode(text) {
    return String(text)
        .replace(/&amp;/gi, "&")
        .replace(/&#(?:0*39|x0*27);|&apos;/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/&nbsp;/gi, " ")
        .replace(/&#(\d+);/g, (match, value) => {
            const code = Number(value);

            return code >= 0 && code <= 0x10FFFF
                ? String.fromCodePoint(code)
                : match;
        })
        .replace(/&#x([0-9a-f]+);/gi, (match, value) => {
            const code = parseInt(value, 16);

            return code >= 0 && code <= 0x10FFFF
                ? String.fromCodePoint(code)
                : match;
        });
}

function cleanText(text) {
    return decode(
        decode(String(text).replace(/<[^>]*>/g, " "))
    ).replace(/\s+/g, " ").trim();
}


// ---------- 获取应用名称 ----------

function resolveName(html, id) {
    const titleMatch = html.match(
        /<title\b[^>]*>([\s\S]*?)<\/title>/i
    );

    const title = cleanText(
        titleMatch ? titleMatch[1] : ""
    );

    const titleName = title.match(
        /^Join the (.+?) beta\s*[-–—]/i
    );

    const statusMatch = html.match(
        /<div\b[^>]*class=["'][^"']*\bbeta-status\b[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*>([\s\S]*?)<\/span>/i
    );

    const statusText = statusMatch
        ? cleanText(statusMatch[1])
        : "";

    const statusName = statusText.match(
        /^To join (?:the )?(.+?) beta, open the link/i
    );

    let name = "";

    if (titleName) {
        name = titleName[1].trim();
    } else if (statusName) {
        name = statusName[1].trim();
    }

    if (name) {
        $persistentStore.write(name, nameKey(id));
    }

    return name ||
        $persistentStore.read(nameKey(id)) ||
        `未获取名称（${id}）`;
}


// ---------- 识别邀请状态 ----------

function classify(html, id) {
    // 只读取邀请状态区，避免匹配通用帮助内容。
    const match = html.match(
        /<div\b[^>]*class=["'][^"']*\bbeta-status\b[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*>([\s\S]*?)<\/span>/i
    );

    if (!match) {
        return {
            state: "unknown",
            text: "未找到邀请状态区"
        };
    }

    const text = cleanText(match[1]);

    const steps = html.match(
        /var\s+showSteps\s*=\s*(true|false)\b/
    );

    const full =
        /This beta is full|已满|已滿/i.test(text);

    const closed =
        /isn't accepting any new testers|不再接受|不接受|暫不|暂不/i
            .test(text);

    const hasInvite = html.includes(
        `itms-beta://testflight.apple.com/join/${id}`
    );

    let state = "unknown";

    if (steps && steps[1] === "false") {
        state = full
            ? "full"
            : closed
                ? "closed"
                : "unavailable";
    } else if (
        steps &&
        steps[1] === "true" &&
        text &&
        hasInvite &&
        !full &&
        !closed
    ) {
        state = "open";
    }

    return { state, text };
}


// ---------- 发送通知 ----------

function notify(id, test, sound, name) {
    const link =
        `https://testflight.apple.com/join/${id}`;

    $notification.post(
        test
            ? "TestFlight 跳转测试"
            : "🚀 TestFlight 邀请已开放",

        name || `未获取名称（${id}）`,

        `${link}\n` +
        (
            test
                ? "测试通知，不代表有空位。点击打开邀请。"
                : "点击打开 TestFlight，手动接受加入。"
        ),

        {
            action: "open-url",
            url: `itms-beta://testflight.apple.com/join/${id}`,
            sound: sound
        }
    );
}


// ---------- 请求邀请页面 ----------

function getPage(id) {
    return new Promise((resolve, reject) => {
        $httpClient.get(
            {
                url:
                    `https://testflight.apple.com/join/${id}`,

                timeout: 15,

                headers: {
                    "Accept-Language": "en-US",
                    "Cache-Control": "no-cache"
                }
            },

            (error, response, body) => {
                if (error) {
                    reject(new Error(String(error)));
                    return;
                }

                if (
                    !response ||
                    Number(response.status) !== 200
                ) {
                    reject(new Error(
                        `HTTP ${
                            response
                                ? response.status
                                : "无响应"
                        }`
                    ));
                    return;
                }

                resolve(String(body || ""));
            }
        );
    });
}


// ---------- 检查单个邀请 ----------

async function check(id, dedup, sound) {
    try {
        const html = await getPage(id);
        const name = resolveName(html, id);
        const result = classify(html, id);

        const labels = {
            open: "可加入",
            full: "名额已满",
            closed: "暂停招募",
            unavailable: "当前不可加入",
            unknown: "状态未知"
        };

        console.log(
            `[${name}] ${labels[result.state]}`
        );

        console.log(
            `邀请链接：https://testflight.apple.com/join/${id}`
        );

        console.log(
            `页面提示：${result.text}`
        );

        // 未知页面不通知，也不覆盖历史记录。
        if (result.state === "unknown") {
            return;
        }

        const previous = $persistentStore.read(
            stateKey(id)
        );

        if (result.state === "open") {
            if (!dedup || previous !== "open") {
                notify(id, false, sound, name);

                console.log(
                    `[${name}] 已调用开放通知`
                );
            } else {
                console.log(
                    `[${name}] 持续开放，去重不重复通知`
                );
            }
        } else {
            console.log(
                `[${name}] 当前不可加入，等待后续开放`
            );
        }

        const saved = $persistentStore.write(
            result.state,
            stateKey(id)
        );

        if (!saved) {
            console.log(
                `[${name}] 保存状态失败，下次可能重复通知`
            );
        }
    } catch (error) {
        console.log(
            `[${id}] 检查失败：${String(error)}`
        );

        // 网络错误不会清除原有去重记录。
    }
}


// ---------- 主流程 ----------

(async () => {
    try {
        if (!params.ids) {
            throw new Error(
                "缺少模块参数，请运行模块生成的 " +
                "TF-Monitor-Module 任务"
            );
        }

        const ids = [...new Set(
            params.ids
                .split("|")
                .map(id => id.trim())
                .filter(Boolean)
        )];

        if (
            !ids.length ||
            ids.length > 10 ||
            ids.some(id => !/^[A-Za-z0-9]{8}$/.test(id))
        ) {
            throw new Error(
                "APP_IDS 填1—10个8位邀请码，多个用 | 分隔"
            );
        }

        const test = getBoolean("test", false);
        const dedup = getBoolean("dedup", true);
        const sound = getBoolean("sound", true);

        const start = getHour("start", 0);
        const end = getHour("end", 23);

        // 测试模式：
        // 尝试获取第一个应用的名称，然后直接发通知。
        // 不检查空位、不重置、不受监控时段限制。
        if (test) {
            const id = ids[0];

            let name = $persistentStore.read(
                nameKey(id)
            );

            try {
                const html = await getPage(id);
                name = resolveName(html, id);
            } catch (error) {
                console.log(
                    `获取名称失败，使用缓存：${String(error)}`
                );
            }

            notify(id, true, sound, name);

            console.log(
                "已调用测试通知，请点击验证跳转"
            );

            return;
        }

        // 重置编号：
        // 0表示不清除，相同编号只处理一次。
        const token = params.reset || "0";

        if (!/^[A-Za-z0-9_-]{1,32}$/.test(token)) {
            throw new Error(
                "RESET_TOKEN 请使用1—32位数字、" +
                "字母、下划线或短横线"
            );
        }

        for (const id of ids) {
            const marker = resetKey(id);

            const previousToken =
                $persistentStore.read(marker);

            if (previousToken !== token) {
                if (token !== "0") {
                    const cleared =
                        $persistentStore.write(
                            null,
                            stateKey(id)
                        );

                    if (!cleared) {
                        throw new Error(
                            `清除记录失败：${id}`
                        );
                    }
                }

                const saved = $persistentStore.write(
                    token,
                    marker
                );

                if (!saved) {
                    throw new Error(
                        `保存重置编号失败：${id}`
                    );
                }

                if (token !== "0") {
                    console.log(
                        `[${id}] 已重置一次，编号=${token}`
                    );
                }
            }
        }

        // 时间段判断：
        // 包含结束小时，支持跨午夜。
        const hour = new Date().getHours();

        const allowed = start <= end
            ? hour >= start && hour <= end
            : hour >= start || hour <= end;

        if (!allowed) {
            console.log(
                `当前${hour}点，不在监控时段，跳过检查`
            );
            return;
        }

        // 每批最多同时检查5个邀请。
        for (let i = 0; i < ids.length; i += 5) {
            await Promise.all(
                ids.slice(i, i + 5).map(
                    id => check(id, dedup, sound)
                )
            );
        }

        console.log("本次检查完成");

    } catch (error) {
        console.log(
            `配置或运行错误：${String(error)}`
        );
    } finally {
        $done();
    }
})();

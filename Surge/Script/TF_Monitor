// ==========================================
// Surge — TestFlight 空位监控
// 配套模块：TF-Monitor.sgmodule
//
// 常用参数在模块编辑界面修改。
// 请从模块生成的任务运行。
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

// ---------- 页面解析 ----------

function decode(text) {
    return text
        .replace(/&amp;/gi, "&")
        .replace(/&#(?:0*39|x0*27);|&apos;/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/&nbsp;/gi, " ");
}

function classify(html, id) {
    // 只提取邀请状态区里的提示。
    // 不使用网页底部的通用帮助内容判断状态。
    const match = html.match(
        /<div\b[^>]*class=["'][^"']*\bbeta-status\b[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*>([\s\S]*?)<\/span>/i
    );

    if (!match) {
        return {
            state: "unknown",
            text: "未找到邀请状态区"
        };
    }

    const text = decode(
        decode(match[1].replace(/<[^>]*>/g, " "))
    ).replace(/\s+/g, " ").trim();

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

function notify(id, test, sound) {
    $notification.post(
        test
            ? "TestFlight 跳转测试"
            : "🚀 TestFlight 邀请已开放",
        `邀请码：${id}`,
        test
            ? "仅测试通知跳转，不代表有空位。点击打开邀请。"
            : "点击前往 TestFlight，手动接受加入。",
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
                url: `https://testflight.apple.com/join/${id}`,
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
        const result = classify(html, id);

        const labels = {
            open: "可加入",
            full: "名额已满",
            closed: "暂停招募",
            unavailable: "当前不可加入",
            unknown: "状态未知"
        };

        console.log(
            `[${id}] ${labels[result.state]}：${result.text}`
        );

        // 页面不明时，不通知、不覆盖历史记录。
        if (result.state === "unknown") return;

        const previous = $persistentStore.read(
            stateKey(id)
        );

        if (result.state === "open") {
            if (!dedup || previous !== "open") {
                notify(id, false, sound);
                console.log(`[${id}] 已调用开放通知`);
            } else {
                console.log(
                    `[${id}] 持续开放，去重不重复通知`
                );
            }
        } else {
            console.log(
                `[${id}] 当前不可加入，等待后续开放`
            );
        }

        const saved = $persistentStore.write(
            result.state,
            stateKey(id)
        );

        if (!saved) {
            console.log(
                `[${id}] 保存状态失败，下次可能重复通知`
            );
        }
    } catch (error) {
        console.log(
            `[${id}] 检查失败：${String(error)}`
        );

        // 网络错误不会清除原来的去重记录。
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

        // 测试模式：只通知，不检查、不重置。
        // 不受监控时间段限制。
        if (test) {
            notify(ids[0], true, sound);
            console.log(
                "已调用测试通知，请点击验证跳转"
            );
            return;
        }

        // 重置编号：0表示不清除。
        const token = params.reset || "0";

        if (!/^[A-Za-z0-9_-]{1,32}$/.test(token)) {
            throw new Error(
                "RESET_TOKEN 请使用1—32位数字、" +
                "字母、下划线或短横线"
            );
        }

        // 每个邀请码分别记录编号。
        // 编号不变时，不会再次重置。
        for (const id of ids) {
            const marker = resetKey(id);
            const previousToken =
                $persistentStore.read(marker);

            if (previousToken !== token) {
                if (token !== "0") {
                    const cleared = $persistentStore.write(
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

        // 时间段判断：包含结束小时，支持跨午夜。
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

import {defineStore} from 'pinia';
import {message} from 'ant-design-vue';
import {eventBus} from '@/eventBus.js';

const {ipcRenderer} = require('electron');
import {useModelStore} from '@/store/ModelStore';
import {useProjectStore} from '@/store/ProjectStore';

export const useMessageStore = defineStore('message_store', {
    state: () => ({
        sessions: [],
        currentSession: {},
        projects: [],
        models: [],
        isStreaming: false,
    }),
    persist: {
        enabled: true,
        strategies: [
            {
                key: 'message_store',
                storage: localStorage,
            },
        ],
    },
    actions: {
        modelsLoad() {
            const modelStore = useModelStore(); // 获取 ModelStore 实例
            this.models = modelStore.models; // 直接从 ModelStore 中读取 models 数据
        },
        async projectsLoad() {
            const projectStore = useProjectStore(); // 获取 ModelStore 实例
            this.projects = projectStore.projects; // 直接从 ModelStore 中读取 models 数据
        },
        async sessionCreate() {
            this.sessions.push(this.currentSession = {
                sessionId: Date.now(),
                currentModel: this.models[0],
                messages: [{
                    role: 'system',
                    content: `\`\`\`json\n${JSON.stringify(this.projects, null, 2)}\n\`\`\``,
                    isAnalyzing: false
                }]
            });
        },
        async sessionDelete(index) {
            this.sessions.splice(index, 1);
        },
        async sessionUpdate() {
            const index = this.sessions.findIndex(s => s.sessionId === this.currentSession.sessionId);
            if (index !== -1) this.sessions[index] = {...this.currentSession};
        },
        async messageSelectFileAndChat(messagelist, index, overwrite, semanticSearch = false) {
            if (!this.currentSession.currentModel) {
                message.error('请选择一个模型');
                return;
            }

            const userask = messagelist[index].content;
            let prompt = `
根据问题和 projectFileDetails 信息，确定与用户问题相关的文件，如果没有相关文件，返回空数组。
返回的 JSON 数据结构为：
{
    analysis: "用户意图分析...",
    reason: ["选择 文件 的原因:...", ...],
    filepath: [文件路径, ...]
}
问题如下：${userask}
`;
            const hidemessagelist = JSON.parse(JSON.stringify(messagelist))
            hidemessagelist[index].content = prompt;
            await this.processChat(hidemessagelist, index, overwrite, semanticSearch);

            const matches = this.currentSession.messages[index + 1]?.content.match(/```json([\s\S]*?)```/);
            const files = matches ? JSON.parse(matches[1].trim()).filepath : [];
            if (!files.length) return;

            const combinedContent = (await Promise.all(
                files.map(file => ipcRenderer.invoke('get-one-file', file).then(info => {
                    const fileType = file.split('.').pop(); // 提取文件扩展名
                    return `${file}:\n\`\`\`${fileType}\n${info.content}\n\`\`\``;
                }))
            )).join('');


            if (!combinedContent) return;

            prompt = `
以下是相关文件的内容:
${combinedContent}
请基于这些内容回答用户的问题: ${userask}
你是一个使用链式思维(chain of Thought，coT)方法并结合反思来回答问题的AI助手。
输出遵循以下格式:
1思考:
按步骤思考并分析问题...,提出相关的解决方案...
2反思:
反思上面思考推理过程，检查是否有错误或改进空间...
3再思考:
根据你的反思做出必要的调整...,提出更完善的解决方案...
4结果:
提供最终的简洁答案...
要求输出代码带有文件路径
`;
            messagelist[index + 2] = {role: "user", content: prompt};
            await this.processChat(messagelist, index + 2, overwrite, semanticSearch);
        },
        async processChat(messagelist, index, overwrite, semanticSearch = false) {
            this.isStreaming = true;
            let allMessages = [...messagelist];

            if (semanticSearch) {
                const prompt = messagelist[messagelist.length - 1].role === "user" ?
                    messagelist[messagelist.length - 1].content : messagelist[messagelist.length - 2].content;
                const results = await this.messagePerformSemanticSearch(prompt);
                const content = results.map(r => `### 参考信息\n\n**查询问题:** ${r.queryText}\n**对应Code:** \`${r.resultText}\``).join('\n\n');
                if (content) allMessages.push({role: 'user', content});
            }

            const modelPayload = {...this.currentSession.currentModel, stream: true, messages: allMessages};
            const response = await fetch(`${modelPayload.baseUrl.replace(/\/?$/, '/')}${'v1/chat/completions'}`, {
                method: 'POST',
                headers: {'Authorization': `Bearer ${modelPayload.apiKey}`, 'Content-Type': 'application/json'},
                body: JSON.stringify(modelPayload)
            });

            this.currentSession.reader = response.body.getReader()
            const decoder = new TextDecoder();
            const assistantIndex = overwrite ? index : index + 1;
            this.currentSession.messages[assistantIndex] = {role: 'assistant', content: '', isAnalyzing: true};

            while (true) {
                const {done, value} = await this.currentSession.reader.read();
                if (done) break;
                this.currentSession.messages[assistantIndex].content += this.parseChatResponse(decoder.decode(value));
                eventBus.emit('messageUpdated', assistantIndex);
            }

            this.currentSession.messages[assistantIndex].isAnalyzing = false;
            this.isStreaming = false;
        },
        parseChatResponse(input) {
            return input.split('data:').reduce((acc, part) => {
                part = part.trim();
                if (part && part !== '[DONE]') {
                    try {
                        const json = JSON.parse(part);
                        if (json.choices?.[0]?.delta?.content) {
                            acc += json.choices[0].delta.content;
                        }
                    } catch (error) {
                        console.error('解析JSON失败:', error, '错误的数据:', part);
                    }
                }
                return acc;
            }, '');
        },
        async stopChat() {
            if (this.isStreaming) {
                await this.currentSession.reader?.cancel();
                this.isStreaming = false;
                eventBus.emit('messageUpdated', null);
                message.success('请求已终止');
            } else {
                message.info('当前没有正在进行的流式请求');
            }
        },
    }
});
// Лимит картинок на запрос. alem.ai (qwen3-8) принимает не больше одной картинки
// во всём запросе, включая историю и результаты инструментов, иначе отвечает
// 400 "At most 1 image(s) may be provided in one prompt". Оставляем самые свежие,
// старые заменяем текстовой пометкой — так сессия не ломается после второй картинки.
const KNOWN_MAX_IMAGES = { "alem-ai/qwen3-8": 1, "alem-ai/qwen3.8": 1 };
const IMAGE_OMITTED_TEXT = "[Здесь было изображение. Ты его видел, когда оно пришло, — опирайся на своё тогдашнее описание. Повторно оно не передаётся: модель принимает ограниченное число изображений за запрос.]";
/** Сколько изображений модель принимает за один запрос; undefined — без ограничений. */
export function getImageLimit(model) {
    if (!model)
        return undefined;
    return typeof model.maxImages === "number" ? model.maxImages : KNOWN_MAX_IMAGES[`${model.provider}/${model.id}`];
}
export function limitImagesForModel(messages, model) {
    const limit = getImageLimit(model);
    if (typeof limit !== "number")
        return messages;
    let remaining = Math.max(0, limit);
    const result = messages.slice();
    for (let i = result.length - 1; i >= 0; i--) {
        const msg = result[i];
        if ((msg.role !== "user" && msg.role !== "toolResult") || !Array.isArray(msg.content))
            continue;
        if (!msg.content.some((c) => c.type === "image"))
            continue;
        const content = [];
        for (let j = msg.content.length - 1; j >= 0; j--) {
            const c = msg.content[j];
            if (c.type !== "image") {
                content.unshift(c);
            }
            else if (remaining > 0) {
                remaining--;
                content.unshift(c);
            }
            else {
                content.unshift({ type: "text", text: IMAGE_OMITTED_TEXT });
            }
        }
        result[i] = { ...msg, content };
    }
    return result;
}

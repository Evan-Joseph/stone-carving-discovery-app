import { artifacts } from "@/data";
import type { Artifact } from "@/types/artifact";

interface OfflineAnswerResult {
  answer: string;
  recommendedIds: string[];
}

const GENERAL_KNOWLEDGE: { keywords: string[]; answer: string; recommendedIds: string[] }[] = [
  {
    keywords: ["三馆", "博物馆", "场馆", "有什么区别", "特点", "分布"],
    answer:
      "鲁西南汉画像石数字展厅汇聚了鲁西南三处文博圣地：\n\n" +
      "1. **嘉祥武氏墓群石刻博物馆**：全国重点文物保护单位，以东汉晚期武氏宗族祠堂（武梁祠、前石室、后石室、左石室）闻名，雕刻精美，题铭众多，是汉代金石学的开山鼻祖与世界级石刻艺术殿堂；\n" +
      "2. **济宁市博物馆**：馆藏汉画像石涵盖神灵祥瑞立柱、永元五年纪年楼阙拜谒图、以及长达2.5米的《民乐图》与《车马出行图》，生动呈现两汉宴乐舞乐与仪仗规制；\n" +
      "3. **巨野县博物馆**：馆藏以核桃园、谢集镇、齐山村出土石刻为主，尤以巨型龙虎图、四兽图、高浮雕羊头石梁与白虎朱雀铺首见长，粗犷雄浑，充满生命力。",
    recommendedIds: ["artifact-001", "artifact-066", "artifact-067", "artifact-069"]
  },
  {
    keywords: ["先看哪几件", "推荐", "入门", "必看", "精华", "看懂"],
    answer:
      "建议按照‘历史故事 → 神灵仙境 → 世俗生活’的脉络依次品读：\n\n" +
      "1. **武梁祠·历史人物长卷**（如《荆轲刺秦王》、《管仲与鲍叔牙》）：领略两汉尚武崇义与忠孝节义思想；\n" +
      "2. **济宁市博·《楼阙人物、拜谒图》**（artifact-066）：汉和帝‘永元五年’（公元93年）纪年碑石，断代标准器；\n" +
      "3. **济宁市博·《民乐图》**（artifact-067）：长达2.5米的长卷，一次看遍汉代农耕、庖厨、长袖折腰舞与百戏杂技；\n" +
      "4. **巨野县博·《齐山村出土羊头图》**（artifact-074）：汉代高浮雕圆浑苍劲，体会古人‘羊大为美、吉羊有余’的吉祥祈愿。",
    recommendedIds: ["artifact-066", "artifact-067", "artifact-074", "artifact-002"]
  },
  {
    keywords: ["神话", "仙人", "祥瑞", "开明兽", "伏羲", "女娲", "羽人"],
    answer:
      "汉代人信奉死后升仙与天人感应，神话题材画像石是汉代精神世界的重要载体：\n\n" +
      "• **羽人与神仙**：常绘长羽翼的仙人乘神兽、引天马，穿行于祥云天界（如济宁神仙祥瑞立柱）；\n" +
      "• **神异灵兽**：九尾开明兽守护昆仑天门、交龙穿璧沟通天地、凤鸟衔珠赐福人间；\n" +
      "• **始祖神话**：伏羲女娲人首蛇身、交尾相缠，手持规矩，象征天地肇始与阴阳生生不息。",
    recommendedIds: ["artifact-062", "artifact-064", "artifact-065", "artifact-001"]
  },
  {
    keywords: ["车马", "出行", "仪仗", "文吏"],
    answer:
      "汉代车马出行图是墓主人生前社会地位或死后升仙仪仗的真实写照：\n\n" +
      "• 严格按照品级配置双马或四马战车（轺车、辎车），随从骑吏环卫；\n" +
      "• 济宁市博的《人物车马出行图》（artifact-068）中24位文吏头戴进贤冠、手执笏板躬身肃立，具有极其珍贵的汉代礼仪与舆服规制研究价值。",
    recommendedIds: ["artifact-068", "artifact-070", "artifact-003"]
  }
];

export function resolveOfflineGuideAnswer(
  question: string,
  targetArtifact?: Artifact,
  contextText?: string
): OfflineAnswerResult {
  const q = question.trim().toLowerCase();

  // 1. If asking about a specific target artifact
  if (targetArtifact) {
    const rawIntro = targetArtifact.infoText || "";
    const cleanIntro = rawIntro.replace(/^#{1,6}\s+/gm, "").trim();

    let detail = `**${targetArtifact.name}**（${targetArtifact.museum || "鲁西南石刻"}）\n\n`;
    detail += `• **时代与出土**：${targetArtifact.series}，现藏于${targetArtifact.museum || "鲁西南文博场馆"}。\n`;
    if (cleanIntro) {
      detail += `• **图像与考据**：\n${cleanIntro.slice(0, 320)}...\n\n`;
    }
    detail += `• **观赏建议**：在详情页点击【显微探照与拓片研学】可启用 100%~500% 无级缩放与黑白墨拓滤镜，能清晰看清石面阴线雕刻与浅浮雕细节。`;

    const related = artifacts
      .filter((a) => a.id !== targetArtifact.id && (a.museum === targetArtifact.museum || a.series === targetArtifact.series))
      .slice(0, 3)
      .map((a) => a.id);

    return {
      answer: detail,
      recommendedIds: related.length ? related : [targetArtifact.id]
    };
  }

  // 2. Search matched artifact name or keyword in question
  const matchedArtifact = artifacts.find(
    (a) => q.includes(a.name.toLowerCase()) || (a.tags && a.tags.some((t) => q.includes(t.toLowerCase())))
  );

  if (matchedArtifact) {
    return resolveOfflineGuideAnswer(question, matchedArtifact, contextText);
  }

  // 3. Match general knowledge topics
  for (const item of GENERAL_KNOWLEDGE) {
    if (item.keywords.some((k) => q.includes(k))) {
      return {
        answer: item.answer,
        recommendedIds: item.recommendedIds
      };
    }
  }

  // 4. Default authoritative answer
  return {
    answer:
      "鲁西南汉画像石是汉代艺术在齐鲁大地的璀璨明珠。这里不仅有以‘天下第一汉画像石’著称的嘉祥武氏祠（武梁祠、前/后/左石室），还有济宁市博物馆珍藏的《民乐图》、《永元五年楼阙拜谒图》，以及巨野县博物馆馆藏的龙虎图、四兽图与齐山村出土羊头高浮雕。\n\n" +
      "您可以直接向我询问特定展品细节（例如‘民乐图有哪些杂技？’、‘武梁祠有什么故事？’），也可以使用‘展厅模式’或‘显微探照台’自由探索。",
    recommendedIds: ["artifact-067", "artifact-066", "artifact-001", "artifact-074"]
  };
}

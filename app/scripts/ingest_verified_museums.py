#!/usr/bin/env python3
"""
增量入库脚本：将济宁市博物馆（7件）与巨野县博物馆（8件）共15件展品及官方展板生成WebP，
并安全增量合并至 artifacts.json，保留原有武氏墓群 61 件全部数据与缓存。
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = ROOT / "app"
MATERIALS = ROOT / "相关材料"
DATA_JSON = APP_ROOT / "src" / "data" / "artifacts.json"
MODEL_CACHE_DIR = APP_ROOT / "public" / "generated" / "models"
INFO_CACHE_DIR = APP_ROOT / "public" / "generated" / "info"

RESAMPLING = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS


def encode_url_path(*parts: str) -> str:
    clean = [quote(part, safe="") for part in parts]
    return "/" + "/".join(clean)


def build_webp_variants(img_path: Path, artifact_id: str) -> dict[str, str]:
    if not img_path.exists():
        raise FileNotFoundError(f"Model image not found: {img_path}")

    thumb_name = f"{artifact_id}-320.webp"
    large_name = f"{artifact_id}-720.webp"
    thumb_path = MODEL_CACHE_DIR / thumb_name
    large_path = MODEL_CACHE_DIR / large_name

    with Image.open(img_path) as raw:
        image = raw.convert("RGBA")

        thumb = image.copy()
        thumb.thumbnail((320, 320), RESAMPLING)
        thumb.save(thumb_path, format="WEBP", quality=82, method=6)

        large = image.copy()
        large.thumbnail((720, 720), RESAMPLING)
        large.save(large_path, format="WEBP", quality=84, method=6)

    return {
        "thumb": encode_url_path("generated", "models", thumb_name),
        "large": encode_url_path("generated", "models", large_name),
    }


def build_info_webp(img_path: Path, artifact_id: str) -> str:
    if not img_path.exists():
        raise FileNotFoundError(f"Info placard image not found: {img_path}")

    info_name = f"{artifact_id}-1280.webp"
    info_path = INFO_CACHE_DIR / info_name

    with Image.open(img_path) as raw:
        image = raw.convert("RGB")
        image.thumbnail((1280, 1280), RESAMPLING)
        image.save(info_path, format="WEBP", quality=86, method=6)

    return encode_url_path("generated", "info", info_name)


# 15件展品人工精确核验清单
NEW_ARTIFACTS_MANIFEST = [
    # --- 济宁市博物馆 (7件) ---
    {
        "id": "artifact-062",
        "name": "神仙祥瑞图 (立柱石刻·一)",
        "museum": "济宁市博物馆",
        "series": "济宁汉画像石",
        "model_file": MATERIALS / "来自济宁市博物馆" / "原始照片" / "微信图片_2026-09-18_203706_717.jpg",
        "info_file": MATERIALS / "来自济宁市博物馆" / "原始照片" / "微信图片_2026-09-18_203730_548.jpg",
        "infoText": """## 神仙祥瑞图
> Auspicious Deities and Omens

- **时代**：东汉 (Eastern Han Dynasty)
- **规格**：长 270 毫米，宽 1420 毫米
- **馆藏**：济宁市博物馆
- **形制**：高立柱石刻

### 画像释读
画面自上而下分五层：
1. 第一层为一大鸟与八只小鸟；
2. 第二层为西王母凭几坐于双峰山巅，旁有羽人、玉兔、侍者及异兽；
3. 第三层为伏羲女娲人首蛇身，其尾交绕；
4. 第四层为羽人倒立舞，旁有倒悬人物；
5. 第五层为二怪兽相对起舞。

> The screen is divided into five registers from top to bottom:
> 1. The first layer depicts a large bird and eight small birds;
> 2. The second layer shows the Queen Mother of the West sitting on a twin-peak mountain top, flanked by winged immortals, jade rabbits, attendants, and strange beasts;
> 3. The third layer portrays Fuxi and Nuwa with human heads and snake bodies with intertwined tails;
> 4. The fourth layer illustrates a winged immortal performing a handstand dance alongside inverted figures;
> 5. The fifth layer presents two strange beasts dancing opposite each other.""",
        "tags": ["济宁市博物馆", "济宁汉画像石", "神仙祥瑞", "西王母", "伏羲女娲", "羽人", "东汉石刻"],
    },
    {
        "id": "artifact-063",
        "name": "仙人祥瑞图 (立柱石刻·二)",
        "museum": "济宁市博物馆",
        "series": "济宁汉画像石",
        "model_file": MATERIALS / "来自济宁市博物馆" / "原始照片" / "微信图片_2026-09-18_203734_083.jpg",
        "info_file": MATERIALS / "来自济宁市博物馆" / "原始照片" / "微信图片_2026-09-18_203736_894.jpg",
        "infoText": """## 仙人祥瑞图
> Immortals and Auspicious Omens

- **时代**：东汉 (Eastern Han Dynasty)
- **规格**：长 290 毫米，宽 1640 毫米
- **馆藏**：济宁市博物馆
- **形制**：高立柱石刻

### 画像释读
画面自上而下分五层：
1. 第一层为人首蛇身神；
2. 第二层为二异兽相对起舞；
3. 第三层为人首鱼身神；
4. 第四层为羽人饲鸟；
5. 第五层为三人首连体怪兽。

> The screen is divided into five registers from top to bottom:
> 1. The first layer depicts a deity with a human head and snake body;
> 2. The second layer shows two strange beasts dancing opposite each other;
> 3. The third layer depicts a deity with a human head and fish body;
> 4. The fourth layer portrays a winged immortal feeding a divine bird;
> 5. The fifth layer presents a three-headed conjoined mythical beast.""",
        "tags": ["济宁市博物馆", "济宁汉画像石", "仙人祥瑞", "人首蛇身", "人首鱼身", "羽人", "东汉石刻"],
    },
    {
        "id": "artifact-064",
        "name": "神仙祥瑞图 (立柱石刻·四)",
        "museum": "济宁市博物馆",
        "series": "济宁汉画像石",
        "model_file": MATERIALS / "来自济宁市博物馆" / "原始照片" / "微信图片_2026-09-18_203739_852.jpg",
        "info_file": MATERIALS / "来自济宁市博物馆" / "原始照片" / "微信图片_2026-09-18_203742_967.jpg",
        "infoText": """## 神仙祥瑞图
> Auspicious Deities and Omens

- **时代**：东汉 (Eastern Han Dynasty)
- **规格**：长 430 毫米，宽 1630 毫米
- **馆藏**：济宁市博物馆
- **形制**：高立柱石刻

### 画像释读
画面自上而下分六层：
1. 第一层为蟾蜍与鱼环绕一圆球；
2. 第二层为一神怪右手执锤，左手擎龙；
3. 第三层为羽人乘玄武；
4. 第四层为羽人骑鹿；
5. 第五层为羽人骑虎；
6. 第六层为羽人骑龙。

> The screen is divided into six registers from top to bottom:
> 1. The first layer shows toads and fish circling a sphere;
> 2. The second layer depicts a mythical being holding a hammer in the right hand and lifting a dragon with the left;
> 3. The third layer depicts a winged immortal riding Xuanwu (the Black Tortoise);
> 4. The fourth layer shows a winged immortal riding a deer;
> 5. The fifth layer depicts a winged immortal riding a tiger;
> 6. The sixth layer portrays a winged immortal riding a dragon.""",
        "tags": ["济宁市博物馆", "济宁汉画像石", "神仙祥瑞", "羽人升仙", "玄武", "神兽", "东汉石刻"],
    },
    {
        "id": "artifact-065",
        "name": "神灵图 (立柱石刻·一)",
        "museum": "济宁市博物馆",
        "series": "济宁汉画像石",
        "model_file": MATERIALS / "来自济宁市博物馆" / "原始照片" / "微信图片_2026-09-18_203745_900.jpg",
        "info_file": MATERIALS / "来自济宁市博物馆" / "原始照片" / "微信图片_2026-09-18_203748_949.jpg",
        "infoText": """## 神灵图
> Picture of Divine Spirits and Beasts

- **时代**：东汉 (Eastern Han Dynasty)
- **规格**：长 500 毫米，宽 1570 毫米
- **馆藏**：济宁市博物馆
- **形制**：高立柱石刻

### 画像释读
画面自上而下分五层：
1. 第一层为凤鸟衔珠；
2. 第二层为六人乘象；
3. 第三层为铺首衔环与九头人面兽（开明兽）；
4. 第四层为二执戟拥彗吏；
5. 第五层为二儿童戏双翼龙。

> The screen is divided into five registers from top to bottom:
> 1. The first layer features a phoenix bird holding a bead in its beak;
> 2. The second layer depicts six people riding a large elephant;
> 3. The third layer portrays a door knocker mask and a nine-headed human-faced beast (Kaiming beast);
> 4. The fourth layer shows two officials holding halberds and brooms;
> 5. The fifth layer shows two children playing with winged dragons.""",
        "tags": ["济宁市博物馆", "济宁汉画像石", "神灵图", "乘象图", "开明兽", "凤鸟", "东汉石刻"],
    },
    {
        "id": "artifact-066",
        "name": "楼阙人物、拜谒图",
        "museum": "济宁市博物馆",
        "series": "济宁汉画像石",
        "model_file": MATERIALS / "来自济宁市博物馆" / "原始照片" / "微信图片_2026-09-18_203752_317.jpg",
        "info_file": MATERIALS / "来自济宁市博物馆" / "原始照片" / "微信图片_2026-09-18_203755_393.jpg",
        "infoText": """## 楼阙人物、拜谒图
> Pavilions, Figures and Audience Scene

- **时代**：东汉 (Eastern Han Dynasty)
- **规格**：长 1300 毫米，宽 810 毫米，厚 150 毫米
- **馆藏**：济宁市博物馆
- **题记**：“太岁在巳永元五年六月成”、“此中人马皆食太仓”

### 画像释读
画面分上下两层：
- **上层**：为厅堂建筑，厅堂内四人端坐，两边为二石阙，阙顶各有一只朱雀立于鹤背之上。石阙与厅堂之间有两行珍贵的隶书题记，分别为：“太岁在巳永元五年六月成”，“此中人马皆食太仓”。
- **下层**：为二车六马向左出行，前有二导骑，二执戟拥彗吏躬身迎候，后跟一随从。

> The image is divided into upper and lower registers:
> - Upper register: A hall building with four figures sitting upright inside. On both sides are two stone watchtowers (que), each topped with a vermilion bird perched on a crane's back. Inscribed in clerical script between the watchtowers and the hall are two historic inscriptions: "Completed in the sixth month of the fifth year of Yongyuan (93 AD)" and "The horses and men here all feed upon the Great Granary".
> - Lower register: Two carriages drawn by six horses traveling leftward, preceded by two guide riders and two welcoming officials holding halberds and brooms, followed by an attendant.""",
        "tags": ["济宁市博物馆", "济宁汉画像石", "楼阙建筑", "拜谒出行", "纪年刻石", "永元五年", "隶书题记", "东汉石刻"],
    },
    {
        "id": "artifact-067",
        "name": "民乐图",
        "museum": "济宁市博物馆",
        "series": "济宁汉画像石",
        "model_file": MATERIALS / "来自济宁市博物馆" / "原始照片" / "微信图片_2026-09-18_203758_266.jpg",
        "info_file": MATERIALS / "来自济宁市博物馆" / "原始照片" / "微信图片_2026-09-18_203800_997.jpg",
        "infoText": """## 民乐图
> Folk Life and Acrobatic Entertainment

- **时代**：东汉 (Eastern Han Dynasty)
- **规格**：长 2500 毫米，宽 580 毫米
- **馆藏**：济宁市博物馆
- **形制**：横幅画像石

### 画像释读
画面生动纪实，分五组生活与百戏场景：
1. 第一组为一人扬鞭策牛拉车，一人扶车前行；
2. 第二组为二人在水井边用桔槔汲水灌溉；
3. 第三组为杀羊剥狗椎牛图，真实还原汉代庖厨劳作；
4. 第四组为百戏图，有倒立、跳丸、吐火、飞刀等杂技绝活；
5. 第五组为射鸟图。

> The panoramic carving is divided into five groups:
> 1. Group 1 shows a figure whipping an ox-drawn cart, with another assisting;
> 2. Group 2 depicts two figures drawing water at a well using a traditional counterweighted well sweep (jiegao);
> 3. Group 3 depicts butchering sheep, dressing dogs, and felling oxen for culinary preparations;
> 4. Group 4 portrays acrobatic performances (baixi), including handstands, ball juggling, fire-spitting, and knife-throwing;
> 5. Group 5 depicts bird archery.""",
        "tags": ["济宁市博物馆", "济宁汉画像石", "世俗生活", "百戏民乐", "农耕汲水", "杂技百戏", "东汉石刻"],
    },
    {
        "id": "artifact-068",
        "name": "人物车马出行图",
        "museum": "济宁市博物馆",
        "series": "济宁汉画像石",
        "model_file": MATERIALS / "来自济宁市博物馆" / "原始照片" / "微信图片_2026-09-18_203803_774.jpg",
        "info_file": MATERIALS / "来自济宁市博物馆" / "原始照片" / "微信图片_2026-09-18_203806_847.jpg",
        "infoText": """## 人物车马出行图
> Procession of Figures and Chariots

- **时代**：东汉 (Eastern Han Dynasty)
- **规格**：长 2500 毫米，宽 600 毫米
- **馆藏**：济宁市博物馆
- **形制**：横幅画像石

### 画像释读
画面宏大严整，分上下两层：
- **上层**：二十四人均头戴进贤冠，身着长袍，手捧简册，躬身肃立，展现东汉儒官文吏恭谨朝谒之礼仪风貌。
- **下层**：战马战车盛大出行场面，前有威风凛凛的导骑开道，中随轺车驰骋，后有步卒持械随行护卫。

> A magnificent composition in two registers:
> - Upper register: Twenty-four officials wearing Jin Xian crowns and long robes, holding bamboo/wooden scrolls in their hands and standing respectfully, illustrating the solemn court etiquette of Eastern Han literati and officials.
> - Lower register: A grand carriage and horse procession with imposing guide riders in the van, galloping carriages in the center, and armed infantry following closely behind.""",
        "tags": ["济宁市博物馆", "济宁汉画像石", "车马出行", "进贤冠", "官吏拜谒", "东汉石刻"],
    },

    # --- 巨野县博物馆 (8件) ---
    {
        "id": "artifact-069",
        "name": "龙虎图",
        "museum": "巨野县博物馆",
        "series": "巨野汉画像石",
        "model_file": MATERIALS / "来自巨野县博物馆" / "原始照片" / "微信图片_2026-09-18_203819_088.jpg",
        "info_file": MATERIALS / "来自巨野县博物馆" / "原始照片" / "微信图片_2026-09-18_203824_881.jpg",
        "infoText": """## 龙虎图
> Drawing of Dragon and Tiger

- **时代**：汉代 (In the Han Dynasty)
- **规格**：长 245 厘米，宽 46 厘米，厚 14 厘米
- **出土**：巨野县核桃园镇出土（1995年入藏）
- **馆藏**：巨野县博物馆

### 画像释读
长幅横石雕刻。画面中青龙与白虎相对，身躯矫健修长，气韵飞动，龙首高昂，虎爪前扑，极具汉代雄浑壮阔的艺术张力。石刻边栏装饰有精美规整的汉代几何连弧三角纹与平行弦纹。

> Carved on a horizontal stone slab. The composition depicts a divine dragon and a white tiger facing each other with vigorous postures, exuding the dynamic momentum and majestic aesthetic characteristic of Han Dynasty stone carving.""",
        "tags": ["巨野县博物馆", "巨野汉画像石", "神兽祥瑞", "龙虎图", "青龙白虎", "汉代石刻"],
    },
    {
        "id": "artifact-070",
        "name": "车马出行图",
        "museum": "巨野县博物馆",
        "series": "巨野汉画像石",
        "model_file": MATERIALS / "来自巨野县博物馆" / "原始照片" / "微信图片_2026-09-18_203827_999.jpg",
        "info_file": MATERIALS / "来自巨野县博物馆" / "原始照片" / "微信图片_2026-09-18_203831_030.jpg",
        "infoText": """## 车马出行图
> Travel of Carriages and Horses

- **时代**：汉代 (In the Han Dynasty)
- **规格**：长 115 厘米，宽 45 厘米，厚 24 厘米
- **出土**：1999年出土于巨野县谢集镇
- **馆藏**：巨野县博物馆

### 画像释读
汉代贵族车马出行经典题材。画像刻画轺车轻便疾驰，良驹扬蹄奔腾，驭手执辔凝神，车舆华盖迎风招展，刀法刚劲爽利，再现汉代鲁西南地区官宦士庶的出行风貌。

> A classic motif depicting Han noble transportation. Light carriages with high canopies are drawn by galloping horses, with drivers holding the reins with intense focus, reflecting the travel manners of the Han gentry in southwestern Shandong.""",
        "tags": ["巨野县博物馆", "巨野汉画像石", "车马出行", "贵族生活", "谢集汉墓", "汉代石刻"],
    },
    {
        "id": "artifact-071",
        "name": "白虎铺首",
        "museum": "巨野县博物馆",
        "series": "巨野汉画像石",
        "model_file": MATERIALS / "来自巨野县博物馆" / "原始照片" / "微信图片_2026-09-18_203834_190.jpg",
        "info_file": MATERIALS / "来自巨野县博物馆" / "原始照片" / "微信图片_2026-09-18_203837_031.jpg",
        "infoText": """## 白虎铺首
> White Tiger Mask

- **时代**：汉代 (In the Han Dynasty)
- **规格**：长 75 厘米，宽 47 厘米，厚 9 厘米
- **馆藏**：巨野县博物馆
- **形制**：门扉画像石（铺首衔环）

### 画像释读
以西方之神白虎为题材的铺首浮雕。虎面圆睁怒视，眉宇轩昂，口衔大铜环，毛发与利齿刻画有力。铺首衔环在汉代多置于墓门或祠堂门扉上，具有辟邪驱秽、镇守冥府之神圣礼仪功能。

> High-relief carving of a White Tiger door mask holding a large ring. Positioned on tomb or shrine doorways, such auspicious guardian beast masks served to ward off evil and protect the sacred precincts.""",
        "tags": ["巨野县博物馆", "巨野汉画像石", "白虎", "铺首衔环", "门扉建筑", "四神兽", "汉代石刻"],
    },
    {
        "id": "artifact-072",
        "name": "朱雀铺首",
        "museum": "巨野县博物馆",
        "series": "巨野汉画像石",
        "model_file": MATERIALS / "来自巨野县博物馆" / "原始照片" / "微信图片_2026-09-18_203839_808.jpg",
        "info_file": MATERIALS / "来自巨野县博物馆" / "原始照片" / "微信图片_2026-09-18_203842_617.jpg",
        "infoText": """## 朱雀铺首
> Rose Finch Mask

- **时代**：汉代 (In the Han Dynasty)
- **规格**：长 59 厘米，宽 39 厘米，厚 11 厘米
- **馆藏**：巨野县博物馆
- **形制**：门扉画像石（四神朱雀）

### 画像释读
以南方朱雀神鸟为核心意象的汉代门扉铺首石刻。朱雀引颈仰天，振翼欲飞，羽翼层次分明如火焰升腾，口衔宝环或吉祥瑞草。线条流畅洗练，寓意祥瑞引导、灵魂升仙。

> A Han architectural stone carving featuring the Vermilion Bird (Rose Finch) of the South. The mythical avian spreads its wings in flight while holding a ceremonial ring in its beak, symbolizing auspicious ascension and spiritual guardianship.""",
        "tags": ["巨野县博物馆", "巨野汉画像石", "朱雀", "铺首衔环", "四神神禽", "汉代石刻"],
    },
    {
        "id": "artifact-073",
        "name": "四兽图",
        "museum": "巨野县博物馆",
        "series": "巨野汉画像石",
        "model_file": MATERIALS / "来自巨野县博物馆" / "原始照片" / "微信图片_2026-09-18_203845_201.jpg",
        "info_file": MATERIALS / "来自巨野县博物馆" / "原始照片" / "微信图片_2026-09-18_203848_509.jpg",
        "infoText": """## 四兽图
> Drawing of Four Wild Animals

- **时代**：汉代 (In the Han Dynasty)
- **规格**：长 245 厘米，宽 50 厘米，厚 23 厘米
- **出土**：巨野核桃园镇出土（2003年入藏）
- **馆藏**：巨野县博物馆

### 画像释读
长幅大幅汉画像石。画面横向展开，刻画四只不同形态的异兽奔腾追逐之景。画面边框上部饰有华丽整齐的垂弧连弧纹及波浪纹带，兽身布满斑纹与矫健肌肉线条，生动体现了汉代先民对自然生灵与神仙仙境的浪漫畅想。

> A horizontal frieze depicting four mythical and wild beasts leaping and pursuing one another across the stone surface, bordered by Han arch fringe patterns and wave motifs.""",
        "tags": ["巨野县博物馆", "巨野汉画像石", "四兽图", "异兽祥瑞", "核桃园汉墓", "汉代石刻"],
    },
    {
        "id": "artifact-074",
        "name": "羊头图 (齐山村出土·一)",
        "museum": "巨野县博物馆",
        "series": "巨野汉画像石",
        "model_file": MATERIALS / "来自巨野县博物馆" / "原始照片" / "微信图片_2026-09-18_203851_664.jpg",
        "info_file": MATERIALS / "来自巨野县博物馆" / "原始照片" / "微信图片_2026-09-18_203854_655.jpg",
        "infoText": """## 羊头图 (齐山村出土·一)
> Sheep Head Drawing I

- **时代**：东汉 (In the Eastern Han Dynasty)
- **规格**：长 199 厘米，宽 57 厘米，厚 25 厘米
- **出土**：1994年入藏，巨野县核桃园镇齐山村出土
- **馆藏**：巨野县博物馆

### 画像释读
石刻中心以减地平雕与线条细刻出硕大羊头，双角向外螺旋弯曲，额间饱满，造型极富几何抽象美感与原始图腾张力。在汉代，“羊”通“祥”，寓意“大吉大利、吉祥如意”。两侧与上方衬托以连绵水波纹与羽状密纹。

> Centered on a stylized ram's head with majestic curled horns. In Han iconography, the sheep/ram (yang) phonetically and symbolically stands for auspicious fortune (xiang).""",
        "tags": ["巨野县博物馆", "巨野汉画像石", "羊头图", "吉羊祥瑞", "齐山村汉墓", "东汉石刻"],
    },
    {
        "id": "artifact-075",
        "name": "羊头图 (齐山村出土·二·配双鱼)",
        "museum": "巨野县博物馆",
        "series": "巨野汉画像石",
        "model_file": MATERIALS / "来自巨野县博物馆" / "原始照片" / "微信图片_2026-09-18_203858_168.jpg",
        "info_file": MATERIALS / "来自巨野县博物馆" / "原始照片" / "微信图片_2026-09-18_203900_860.jpg",
        "infoText": """## 羊头图 (齐山村出土·二·配双鱼)
> Sheep Head Drawing II (with Twin Fish)

- **时代**：东汉 (In the Eastern Han Dynasty)
- **规格**：长 145 厘米，宽 53 厘米，厚 20 厘米
- **出土**：1994年入藏，巨野县核桃园镇齐山村出土
- **馆藏**：巨野县博物馆

### 画像释读
构图奇巧优美。正中雕刻雄健正面羊首，左右对称浮雕两尾大鱼，鱼身鳞纹毕现、体态肥硕。在汉代石刻语汇中，“羊”代表吉祥，“鱼”代表年年有余、子孙繁衍，合为“吉祥有余”的美好祝颂。上部横向分布多道密致平行的齿状横条纹饰。

> A beautifully balanced composition pairing a central ram head with two mirrored fish on either flank. Combining 'ram' (good omen) and 'fish' (abundance), the image conveys the classic Han wish for boundless blessing and prosperity.""",
        "tags": ["巨野县博物馆", "巨野汉画像石", "羊首双鱼", "吉祥有余", "齐山村汉墓", "东汉石刻"],
    },
    {
        "id": "artifact-076",
        "name": "石虎 (苏坑元代墓出土)",
        "museum": "巨野县博物馆",
        "series": "巨野元代雕刻",
        "model_file": MATERIALS / "来自巨野县博物馆" / "原始照片" / "微信图片_2026-09-18_203904_105.jpg",
        "info_file": MATERIALS / "来自巨野县博物馆" / "原始照片" / "微信图片_2026-09-18_203907_109.jpg",
        "infoText": """## 石虎
> Stone Tiger

- **时代**：元代 (In the Yuan Dynasty)
- **规格**：高 100 厘米
- **出土**：苏坑元代墓出土
- **馆藏**：巨野县博物馆
- **形制**：圆雕墓道石兽

### 画像释读
圆雕石刻艺术精品。石虎蹲踞蹲立，阔口呲牙，鼻吻丰隆，双目突起，胡须刻划粗犷有力，通体刀法浑厚古拙，神态憨勇威严。作为元代贵族墓前神道镇墓兽，为研究宋元时期鲁西南地区石雕造像艺术演变提供了极珍贵的实物标本。

> A three-dimensional stone sculpture of a tiger from the Yuan Dynasty. Featuring an open snout, bared teeth, and sturdy limbs, this funerary spirit-way beast offers rare evidence of medieval stone-sculpting styles in southwestern Shandong.""",
        "tags": ["巨野县博物馆", "巨野元代雕刻", "圆雕石虎", "苏坑元代墓", "神道石兽", "元代石刻"],
    },
]


def run():
    print("=== 开始增量生成 WebP 图片与展品元数据 ===")
    MODEL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    INFO_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    if not DATA_JSON.exists():
        raise FileNotFoundError(f"Data JSON not found: {DATA_JSON}")

    with open(DATA_JSON, "r", encoding="utf-8") as f:
        dataset = json.load(f)

    existing_artifacts = dataset.get("artifacts", [])
    print(f"当前库中文物总数: {len(existing_artifacts)}")

    # 为原有展品安全回填 museum 字段
    for item in existing_artifacts:
        if "museum" not in item:
            item["museum"] = "武氏墓群石刻博物馆"

    # 构建已有 ID 索引，确保幂等更新
    existing_map = {item["id"]: item for item in existing_artifacts}

    new_count = 0
    for meta in NEW_ARTIFACTS_MANIFEST:
        art_id = meta["id"]
        name = meta["name"]
        museum = meta["museum"]
        series = meta["series"]
        info_text = meta["infoText"].strip()
        tags = meta["tags"]

        print(f"正在处理 [{art_id}] {name} ({museum})...")
        webp_variants = build_webp_variants(meta["model_file"], art_id)
        info_webp = build_info_webp(meta["info_file"], art_id)

        artifact_entry = {
            "id": art_id,
            "name": name,
            "museum": museum,
            "series": series,
            "modelImage": webp_variants["large"],
            "modelImageThumb": webp_variants["thumb"],
            "modelImageLarge": webp_variants["large"],
            "infoImage": info_webp,
            "infoText": info_text,
            "pdfPages": [],
            "pdfTopic": "",
            "linkedPdf": [],
            "tags": tags,
        }

        if art_id in existing_map:
            idx = next(i for i, x in enumerate(existing_artifacts) if x["id"] == art_id)
            existing_artifacts[idx] = artifact_entry
            print(f"  -> 已更新已有项 {art_id}")
        else:
            existing_artifacts.append(artifact_entry)
            new_count += 1
            print(f"  -> 已新增入库 {art_id}")

    dataset["artifacts"] = existing_artifacts
    dataset["totalArtifacts"] = len(existing_artifacts)
    dataset["generatedAt"] = datetime.now().isoformat(timespec="seconds")

    with open(DATA_JSON, "w", encoding="utf-8") as f:
        json.dump(dataset, f, ensure_ascii=False, indent=2)

    print(f"\n全部处理成功！")
    print(f"更新后展品总数: {dataset['totalArtifacts']} 件 (本次新增: {new_count} 件)")
    print(f"数据已安全写入 -> {DATA_JSON}")


if __name__ == "__main__":
    run()

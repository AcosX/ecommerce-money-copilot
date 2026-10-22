#!/usr/bin/env python3
# ruff: noqa: E501
"""将 knowledge.zip（小红书电商课程知识库 + 拼多多新手开店知识库）构建为小商 Agent 结构化知识库。

输出文件：
  backend/emc_api/data/agent_knowledge_base.json
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_JSON = REPO_ROOT / "backend" / "emc_api" / "data" / "agent_knowledge_base.json"

EXTRACTED_BASE = Path("knowledge_extracted")
XHS_DIR = EXTRACTED_BASE / "xiaohongshu" / "分享版_小红书电商课程知识库"
PDD_DIR = EXTRACTED_BASE / "pinduoduo(1)" / "拼多多新手开店知识库"

# 针对视频逐字稿（前段含直播间互动暖场）或 引言页 的小红书课程，提供精炼高密度结构化摘要
XHS_CURATED_SUMMARIES: dict[int, dict[str, Any]] = {
    4: {
        "category": "店铺案例",
        "level_id": "L1",
        "summary": (
            "饰品主理人从0到1起店实战：拒绝盲目铺货，围绕特定审美人群做垂直风格饰品；"
            "通过高频实拍佩戴商品笔记测试爆款，再用固定频次店播承接高意向粉丝，实现小团队高复购稳定盈利。"
        ),
        "key_points": [
            "聚焦垂直审美人群，用统一视觉调性建立主理人信任感",
            "先靠商品笔记低成本测出高点击/高加购饰品款，再集中备货",
            "坚持固定时段店播展示佩戴细节，带动老客复购与连带率",
        ],
    },
    7: {
        "category": "店铺案例",
        "level_id": "L2",
        "summary": (
            "服饰商家转型小红书实战：避开全网低价内卷，从用户真实穿搭痛点（显瘦、通勤、小个子/微胖）切入选品；"
            "把笔记当成穿搭解决方案而非单纯货架，配合店播试穿讲解跑通高客单闭环。"
        ),
        "key_points": [
            "按身材痛点与穿搭场景选品，避免同质化通货比价",
            "笔记呈现上身前后对比与搭配公式，提高收藏率与商卡点击",
            "店播间按身高体重报尺码，降低女装退货率",
        ],
    },
    8: {
        "category": "店铺直播",
        "level_id": "L5",
        "summary": (
            "大服饰店播增长策略解析：构建『日常稳态平播 + 节点大场爆发』双飞轮。"
            "笔记是直播曝光第一渠道，通过笔记呼吸灯与预告预约把种草人群引入直播间，实现高转化与高新客占比。"
        ),
        "key_points": [
            "双飞轮模型：日常平播测款攒人群资产，大场直播集中释放福利冲GMV",
            "开播期间持续发普通种草笔记，利用头像『直播呼吸灯』撬动公域免费流",
            "主播话术围绕面料细节、版型对比与限时促单，拉升人均停留与转粉率",
        ],
    },
    9: {
        "category": "爆款案例",
        "level_id": "L6",
        "summary": (
            "双11单品打爆1200W+GMV复盘：选中一件高质感『人生大衣』核心主推款，提前30天多角度铺设痛点种草笔记蓄水；"
            "大促期通过笔直群联动+千帆人群追投，将种草人群在店播间集中收割转化。"
        ),
        "key_points": [
            "单品聚焦策略：集中80%内容预算打透1个高客单、高毛利核心爆款",
            "蓄水期多维度拆解面料、版型、多场景穿搭，积累高意向收藏加购人群",
            "爆发期『笔记呼吸灯+群聊预告+长时店播』三端共振放大GMV",
        ],
    },
    10: {
        "category": "笔记运营",
        "level_id": "L4",
        "summary": (
            "春上新时尚行业商品笔记玩法攻略：把握换季趋势热搜词，提前布局春装上新痛点选题；"
            "通过高审美首图+精准趋势词标题+左下角商品组件挂载，抢占换季搜索与推荐双流量池。"
        ),
        "key_points": [
            "紧跟千帆『社区热搜词』中的换季飙升词布局标题与话题Tag",
            "首图突出换季穿搭氛围感与显瘦痛点，提升双列信息流点击率",
            "上新期保持日更3–5篇商品笔记，快速筛选高潜爆款",
        ],
    },
    11: {
        "category": "店铺直播",
        "level_id": "L5",
        "summary": (
            "春上新时尚行业店铺直播玩法攻略：围绕春装上新主题打造专场店播，播前48–72小时发布预告笔记蓄水，"
            "播中采用『引流福利款+主推利润款+搭配连带款』排品节奏提升场观与UV价值。"
        ),
        "key_points": [
            "播前发布春上新剧透笔记并挂载直播预约卡，锁定高意向老粉",
            "直播间排品遵循『福利款留人、主推款冲量、形象款拔高客单』",
            "下播后剪辑高光试穿切片二次分发，延续7天长尾成交",
        ],
    },
    16: {
        "category": "大促运营",
        "level_id": "L6",
        "summary": (
            "小红书电商双11大服饰行业运营分享：围绕『蓄水期种草测款—预热期预约锁客—爆发期笔直联动冲峰』三阶段节奏，"
            "用好平台跨店满减、新客券与千帆推广工具实现大促跃迁。"
        ),
        "key_points": [
            "大促前2–3周完成主推款筛选与库存备货，避免爆单断码",
            "预热期通过粉丝群、笔记评论区置顶引导领券与加购",
            "爆发期拉长店播时长并开启千帆种草人群追投，最大化ROI",
        ],
    },
    17: {
        "category": "店铺案例",
        "level_id": "L4",
        "summary": (
            "小红书女装商家店铺销量逆袭3步曲：①重新精准锚定细分人群人设；"
            "②建立爆款笔记拆解与日更赛马机制；③打通『商品笔记种草 + 店铺直播转化 + 粉丝群复购』闭环。"
        ),
        "key_points": [
            "第一步立人设：明确店主身材特征与审美标签，吸引同频精准买家",
            "第二步抓爆文：7步拆解同行高赞笔记，批量复制验证高点击封面与选题",
            "第三步建闭环：笔记引流进播、直播沉淀入群，把单次流量变成长期资产",
        ],
    },
    19: {
        "category": "新商冷启",
        "level_id": "L1",
        "summary": (
            "服饰商家起号实战案例拆解：新店冷启动前30天不盲目砸投流，先选准3–5个对标账号拆解爆款结构，"
            "靠高频实拍穿搭笔记跑通自然流首单，再逐步叠加店播与商业化放大。"
        ),
        "key_points": [
            "找准体量适中、近期持续出爆款的同行新锐店作为对标账号",
            "冷启期以真实上身实拍+痛点解决文案建立账号初始人群标签",
            "自然流跑出点击率>8%、商卡点击率高的笔记后再跟进同款选题",
        ],
    },
    24: {
        "category": "新商冷启",
        "level_id": "L1",
        "summary": (
            "新商冷启10节精品课（账号定位篇）：从传统卖货思维转向用户痛点思维。"
            "记住账号北极星公式：【我服务谁 + 帮TA解决什么具体痛点 + 用什么产品/方式解决】"
            "（如从『卖给25-45岁女性长裙』转为『帮梨形身材胯大腿粗女生穿出显瘦好比例』）。"
        ),
        "key_points": [
            "拒绝『25-45岁女性通用』宽泛定位，人群越具体痛点越锋利",
            "北极星公式：服务特定客群 + 解决具体场景痛点 + 产品独特方案",
            "账号名称、简介、置顶笔记、选品与直播话术全部对齐同一用户画像",
        ],
    },
    25: {
        "category": "笔记运营",
        "level_id": "L4",
        "summary": (
            "Vol.9 新商必学｜关注4个地方让内容获得更多曝光机会："
            "①定期参与创作者中心官方活动并带活动话题；②关注垂类官方薯（如@时尚薯/@家居薯/@电商学习薯）参与垂类话题；"
            "③用千帆PC【经营-搜索运营】查热门搜索词、飙升词与低竞争长尾词；④拆解同赛道Top账号近7天高频词与选题。"
        ),
        "key_points": [
            "巧用创作者中心【官方活动话题】，绑定相关笔记拿活动流量池加持",
            "紧跟垂类官方薯（时尚薯/美妆薯/家居薯）获取新手基础流量扶持",
            "善用千帆【经营-搜索运营】挖掘近期飙升词与高转化长尾词",
            "每周追踪同赛道Top账号近7天高频关键词与爆款呈现形式",
        ],
    },
    30: {
        "category": "笔记运营",
        "level_id": "L4",
        "summary": (
            "爆款拆解黄金公式｜7步复制热门行业爆文：核心五字诀『找对标 → 拆结构 → 快复制 → 规模发 → 看数据迭代』。"
            "重点拆解同行低粉爆文的封面视觉钩子、痛点标题词根、前3秒留人痛点与评论区转化组件。"
        ),
        "key_points": [
            "优先找『粉丝量不大但单篇点赞/交易高』的近期同行低粉爆文做对标",
            "拆解爆文四要素：首图场景视觉反差、标题痛点关键词、正文卖点排序、评论区置顶引导",
            "同一个验证过的爆款选题换3种封面/切角矩阵发布，赛马测出最高转化版本",
        ],
    },
    32: {
        "category": "全域联动",
        "level_id": "L5",
        "summary": (
            "NPL全链路实战课：小红书电商核心增长飞轮 NPL = Note（笔记种草）× Private（群聊私域蓄水）× Live（店铺直播转化）。"
            "三大核心考核指标：笔记点击与商卡互动率、粉丝与老客下单占比、直播预约人数与进播转化率。"
        ),
        "key_points": [
            "N（笔记场）：持续输出痛点种草笔记与呼吸灯引流，获取精准公域新客",
            "P（私域群聊）：用群专享券、上新剧透与晒单互动把公域流量沉淀为高复购老客",
            "L（店铺直播）：承接笔记呼吸灯与群聊预约流量，实时试穿答疑完成高客单收割",
        ],
    },
    36: {
        "category": "新商冷启",
        "level_id": "L1",
        "summary": (
            "笔记运营实战第1课—小红书账号人设怎么做：小红书是『人感社区』，用户更愿意向鲜活专业的人买单而非冰冷货架。"
            "通过『主理人/买手专业身份 + 真实生活/选品场景 + 固定视觉与语言风格』三步立住高信任度账号人设。"
        ),
        "key_points": [
            "拒绝把账号做成杂乱百货店或纯白底商品说明书，先立『懂行闺蜜/主理人』人设",
            "人设四件套：好记垂直昵称、真实头像、一句话价值简介、统一封面视觉色调",
            "用真实选品幕后、踩坑测评、痛点解答拉近距离，降低用户下单决策门槛",
        ],
    },
    42: {
        "category": "笔记运营",
        "level_id": "L4",
        "summary": (
            "第一篇笔记：给用户一个点击的理由。笔记是用户痛点的答案而非产品说明书！"
            "决定双列信息流点击率的黄金三件套是【封面 + 标题 + 前3秒】；切忌用白底产品图做封面（点击率不足1%），"
            "必须用真实使用场景+痛点视觉反差图吸引点击。"
        ),
        "key_points": [
            "点击率黄金三件套：吸睛场景封面 + 痛点/反差标题 + 视频前3秒黄金钩子",
            "封面避坑：严禁纯白底证件照式产品图+大Logo，改用原生生活感实拍图",
            "标题技巧：植入目标人群身份词+具体痛点+解决方案数字锚点",
        ],
    },
    44: {
        "category": "笔记运营",
        "level_id": "L4",
        "summary": (
            "笔记创作六要素拆解：决定一篇电商笔记既有流量又有转化的6大核心要素——"
            "①标题（抓搜索热词与人群痛点）、②封面（高点击率原生场景图）、③正文（痛点引入-卖点对比-使用效果）、"
            "④内容画面（直观展示功能/上身效果）、⑤话题Tag（热搜词+品类词+活动词）、⑥评论区打造（置顶组件与问答促单）。"
        ),
        "key_points": [
            "要素1–2（决定点击率）：封面真实有视觉冲击力，标题埋入高搜索量痛点关键词",
            "要素3–4（决定完播与种草）：正文与画面先戳使用痛点，再直观演示产品解决效果",
            "要素5–6（决定流量池与转化）：带准社区热搜Tag，并在评论区置顶商品/群聊/尺码解答促成交",
        ],
    },
    46: {
        "category": "笔记运营",
        "level_id": "L4",
        "summary": (
            "怎么写出一篇好笔记：选题不是你想讲什么，而是用户在搜什么、烦什么！"
            "掌握4大万能选题公式：①身份+场景+痛点；②数字+结果+反差；③踩坑经历+最终答案；④行业黑话+内行揭秘。"
            "从评论区吐槽、搜索下拉词、客服私信高频问题3个渠道挖掘源源不断的爆款选题。"
        ),
        "key_points": [
            "公式1【身份+场景+痛点】：如『上班族妈妈早6点，10分钟搞定营养早餐』",
            "公式2【数字+结果+反差】与公式3【踩坑+答案】：用真实测评感建立极高信任度",
            "公式4【行业内幕+揭秘】：满足好奇心，拉满完读率与收藏率",
            "选题金矿：同行评论区高频追问、小红书搜索框下拉联想词、自家客服私信提问",
        ],
    },
    47: {
        "category": "笔记运营",
        "level_id": "L4",
        "summary": (
            "笔记转化：解锁笔记4种挂载方式，把单车道变成四车道！"
            "①挂商品链接（种草笔记最短成交路径，商品须与正文高度相关）；②挂直播预约（开播前蓄水导流）；"
            "③挂群聊（把公域读者沉淀至私域粉丝群做长期复购）；④挂小程序（适合定制/服务类商家）。"
        ),
        "key_points": [
            "挂商品卡片：适合高种草痛点笔记，实现『边看边买』最短交易闭环",
            "挂直播预约：适合上新剧透与福利预告笔记，为直播间提前锁定精准场观",
            "挂粉丝群聊：把围观流量沉淀进群，配合群内专属券把第1单变成长期复购",
        ],
    },
    48: {
        "category": "新商冷启",
        "level_id": "L1",
        "summary": (
            "Vol.1 新商必学｜起号开店前一个月要做什么：①完成专业号认证与店铺基础开通（保证金、物流模板、客服欢迎语）；"
            "②明确目标客群画像与核心痛点定位；③找准5–10个同赛道优质对标账号建立选题库；④上架首批核心引流款与利润款并开启日更测款。"
        ),
        "key_points": [
            "开店基建先行：完善店铺资质、运费模板、退货地址与自动客服欢迎语",
            "定位定生死：先明确『服务哪类细分人群的什么痛点』，再统一账号视觉与昵称",
            "首月聚焦测款：前30天坚持规律发布实拍笔记，跑通自然流点击率与首单闭环",
        ],
    },
    49: {
        "category": "新商冷启",
        "level_id": "L2",
        "summary": (
            "Vol.2 新商必学｜新店起号怎么找对标账号：不要找粉丝几十万的成熟大牌，要找『近1–3个月新起盘、粉丝1000–2万、"
            "但频繁出现高赞/高交易低粉爆文』的同品类新锐商家账号，通过搜索核心品类词+筛选最新/最热笔记顺藤摸瓜。"
        ),
        "key_points": [
            "对标三标准：同品类/同价格带、近90天新起号、有『低粉高赞/高销量』近期爆文",
            "避开大V误区：头部品牌靠场外知名度，新商直接照搬大牌形象片必死",
            "建立对标库：收集至少10个同行新锐账号，每周追踪其上新款与爆文切角",
        ],
    },
    50: {
        "category": "新商冷启",
        "level_id": "L2",
        "summary": (
            "Vol.3 新商必学｜找到对标账号后学什么：重点拆解对标账号的4个维度——"
            "①人设与主页装修（昵称、简介价值主张、置顶笔记）；②货盘结构（引流款、主推利润款、定价策略）；"
            "③爆款笔记黄金结构（首图构图、标题痛点词、前3秒钩子、话题Tag）；④评论区运营与群聊/店播承接方式。"
        ),
        "key_points": [
            "学货盘：看对方销量最高的TOP3商品是什么价格带、解决什么核心痛点",
            "学内容：拆解对方点赞最高的3篇笔记为什么能火（封面光线、对比感、标题词根）",
            "学承接：观察对方评论区如何置顶引导商卡或粉丝群、每天什么时段开店播",
        ],
    },
    51: {
        "category": "新商冷启",
        "level_id": "L1",
        "summary": (
            "Vol.4 新商必学｜新商起号常犯的错有哪些：①把小红书当传统货架，海量铺货且直接发白底厂家图；"
            "②账号内容杂乱无章，今天发宠物明天发女装导致人群标签混乱；③急于求成，发2篇没流量就断更或盲目删改笔记；"
            "④忽视评论区互动与客服响应，白白流失高意向询单。"
        ),
        "key_points": [
            "大忌1：直接搬运1688白底主图或硬广说明书，缺乏真实生活场景与利他价值",
            "大忌2：频繁跨类目发帖或随意删除/隐藏已有笔记，破坏系统人群推荐标签",
            "大忌3：只发笔记不维护评论区，错过黄金前2小时互动加权与询单转化",
        ],
    },
    52: {
        "category": "笔记运营",
        "level_id": "L4",
        "summary": (
            "Vol.5 新商必学｜我是不是被限流了？如何正确排查：新号小眼睛几十到一两百属于正常初始流量池（非违规限流）！"
            "先在千帆/创作者中心排查是否有违规提示（如站外导流微信号、夸大绝对化用语、搬运抄袭）；"
            "若无违规，小眼睛低的核心原因是封面与标题点击率不足，系统未能推入下一级流量池。"
        ),
        "key_points": [
            "区分『初始流量池未晋级』与『违规限流』：小眼睛100–200是正常冷启测试池",
            "严守合规红线：不在笔记/评论/私信放微信号或站外链接，禁用极限词与虚假对比",
            "破局动作：不删旧笔记，重点优化首图视觉反差与痛点标题，提升双列点击率与CES互动分",
        ],
    },
    53: {
        "category": "笔记运营",
        "level_id": "L4",
        "summary": (
            "Vol.6 新商必学｜到底发普通笔记好还是商品笔记好？官方明确：商品笔记（商笔）是挂载商品卡片的笔记形态，"
            "只要内容真实不违规，商笔同样享有自然推荐流量与热搜词扶持，且能实现『边逛边买』最短成交闭环！"
            "建议冷启期采用『普通笔记（测选题/拉互动涨粉）+ 商品笔记（直接挂车承接转化）』组合并行。"
        ),
        "key_points": [
            "破除迷信：挂商品链接不会导致限流，内容与所挂商品高度相关反而有电商流量加持",
            "普通笔记作用：适合干货合集、人设故事、直播预告呼吸灯，进入社区大流量池拉新蓄水",
            "商品笔记作用：针对具体痛点种草单品，左下角直接出商卡，缩短下单路径提升成交率",
        ],
    },
    54: {
        "category": "新商冷启",
        "level_id": "L4",
        "summary": (
            "Vol.7 新商必学｜适合小红书新商的起号冷启方式：主推『低成本内容种草冷启 + 笔直群小步快跑』。"
            "第1–2周聚焦1个核心痛点款日更实拍笔记测点击率；第3周开启固定时段平播（先求播稳不冲GMV）并建粉丝群沉淀首批100个种子老客；"
            "跑出高转化笔记后再用千帆小额追投放大。"
        ),
        "key_points": [
            "冷启阶段一（0–14天）：围绕1–2款痛点引流品做多角度笔记AB测试，打准人群标签",
            "冷启阶段二（15–30天）：开启日常店播+粉丝群，利用笔记呼吸灯把种草读者引入直播间成交",
            "冷启阶段三（30天后）：筛选自然流高转化爆文，配合千帆推广放大ROI",
        ],
    },
    55: {
        "category": "笔记运营",
        "level_id": "L4",
        "summary": (
            "Vol.8 新商必学｜小红书的笔记流量逻辑一篇讲清楚：两大核心来源为【推荐流量（发现页个性化分发）】与【搜索流量（用户主动搜关键词）】。"
            "推荐流采用阶梯流量池赛马机制，依据点击率、完播率及 CES 互动评分『(点赞+评论)×1 + (收藏+转发+关注)×4』层层晋级；"
            "搜索流则取决于封面、标题、正文与话题Tag中埋入的高热度精准关键词。"
        ),
        "key_points": [
            "阶梯赛马机制：初始曝光池 → 考核点击率与CES互动权重 → 晋级更大推荐流量池",
            "CES核心公式：(点赞+评论)×1 + (分享+收藏+转粉)×4，诱导收藏/分享/关注权重最高",
            "双轮驱动：用高反差封面拿推荐流，用『社区热搜词+痛点长尾词』卡位搜索流长尾成交",
        ],
    },
    56: {
        "category": "笔记运营",
        "level_id": "L4",
        "summary": (
            "Vol.10 新商必学｜为什么笔记没违规但流量上不去？四大核心卡点诊断："
            "①选题自嗨（讲产品参数而非用户痛点，没人搜也没人关心）；②首图点击率低（低于5%，在双列流中被直接划走）；"
            "③前3秒/首段留存差（铺垫太长未直击痛点）；④缺乏互动钩子（结尾与评论区没有引导收藏/提问，CES分偏低）。"
        ),
        "key_points": [
            "卡点1（没展现）：标题缺少千帆热搜词与品类高频词，错失搜索流量",
            "卡点2（有展现没点击）：首图缺乏对比感或痛点大字不够醒目，需准备3版封面测款",
            "卡点3（有点击没互动）：正文末尾增加『选A还是选B/需要尺码表扣1』互动钩子拉升CES得分",
        ],
    },
}


def clean_text(raw: str) -> str:
    text = raw
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"^\[\d{2}:\d{2}\.\d{2}\]\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^---\s*图片:.*?---$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\*以上.*?为准。?", "", text)
    text = re.sub(r"如果你对本期内容有什么看法.*", "", text)
    text = re.sub(r"={10,}", " ", text)
    text = re.sub(r"[#*`>~|🔗●]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def infer_level_id(title: str, category: str, body: str) -> str:
    t = f"{title} {category} {body[:240]}".lower()
    if any(
        k in t
        for k in (
            "入驻",
            "开店",
            "店名",
            "命名",
            "定位",
            "人设",
            "保证金",
            "企业店",
            "个人店",
            "个体",
            "主营类目",
            "资质",
            "0元入驻",
            "新商必学 i 起号",
        )
    ):
        return "L1"
    if any(
        k in t
        for k in (
            "选品",
            "选款",
            "货源",
            "批发",
            "蓝海",
            "产业带",
            "1688",
            "趋势类目",
            "爆款商机",
            "市场机会",
            "对标账号",
        )
    ):
        return "L2"
    if any(
        k in t
        for k in (
            "定价",
            "毛利",
            "成本",
            "算账",
            "轮播图",
            "详情",
            "拍摄",
            "构图",
            "景深",
            "视觉",
            "视频制作",
            "尺码表",
            "卖点",
            "先用后付",
        )
    ):
        return "L3"
    if any(
        k in t
        for k in (
            "笔记",
            "热搜词",
            "流量",
            "冷启",
            "破0",
            "破零",
            "搜索",
            "千帆推广",
            "曝光",
            "阅读数",
            "点击",
            "挂载",
            "限流",
            "起号",
            "短标题",
        )
    ):
        return "L4"
    if any(
        k in t
        for k in (
            "发货",
            "快递",
            "面单",
            "物流",
            "售后",
            "退货",
            "客服",
            "仅退款",
            "直播",
            "店播",
            "场观",
            "开播",
            "申诉",
            "违规",
            "罚款",
            "发票",
        )
    ):
        return "L5"
    if any(
        k in t
        for k in (
            "复盘",
            "复购",
            "用户资产",
            "建群",
            "涨粉",
            "会员",
            "双11",
            "大促",
            "对账",
            "提现",
            "资金",
        )
    ):
        return "L6"
    if category == "开店流程":
        return "L1"
    if category == "商品发布":
        return "L3"
    if category in ("发货操作", "平台规则"):
        return "L5"
    if category == "账号与资金":
        return "L6"
    return "L4"


def extract_keywords(
    title: str,
    category: str,
    platform: str,
    tags: list[str] | None = None,
    extra_text: str = "",
) -> list[str]:
    kws: list[str] = []
    for base_kw in [platform, category] + (tags or []):
        if base_kw and base_kw not in kws:
            kws.append(base_kw)

    stop = {
        "如何",
        "什么",
        "怎么",
        "哪些",
        "可以",
        "需要",
        "系列课",
        "合集",
        "问题",
        "常见",
        "指南",
        "教程",
        "介绍",
        "说明",
        "使用",
        "操作",
        "商家",
        "店铺",
        "商品",
        "课程",
        "学习",
        "分享",
        "我们",
        "大家",
    }
    for tok in re.findall(r"[\u4e00-\u9fa5]{2,6}|[A-Za-z0-9+]{2,}", f"{title} {extra_text[:120]}"):
        if tok not in stop and tok not in kws:
            kws.append(tok)
        if len(kws) >= 14:
            break
    return kws


def extract_bullet_points(raw_text: str, fallback_summary: str) -> list[str]:
    points: list[str] = []
    for line in raw_text.splitlines():
        s = line.strip()
        s = re.sub(r"^[#*>\-●•\d.、()（）]+", "", s).strip()
        s = re.sub(r"[*`🔗]+", "", s).strip()
        if 12 <= len(s) <= 95 and not s.startswith(
            ("来源：", "课程ID", "时长：", "编号：", "原文链接")
        ):
            if any(
                k in s
                for k in (
                    "：",
                    ":",
                    "建议",
                    "步骤",
                    "第",
                    "路径",
                    "公式",
                    "要求",
                    "避免",
                    "通过",
                    "提升",
                    "设置",
                    "规则",
                    "方法",
                    "注意",
                )
            ):
                if s not in points:
                    points.append(s)
        if len(points) >= 4:
            break
    if not points and fallback_summary:
        parts = [
            p.strip() for p in re.split(r"[；;。！!]", fallback_summary) if len(p.strip()) >= 10
        ]
        points = parts[:3]
    return points[:4]


def build_core_items() -> list[dict[str, Any]]:
    return [
        {
            "id": "kb_roi_formula",
            "course_code": "EMC-CORE-01",
            "platform": "通用",
            "category": "财务算账",
            "level_id": "L3",
            "title": "保本 ROI（投产比）与真实毛利率核心公式",
            "keywords": [
                "roi",
                "投产比",
                "保本",
                "毛利",
                "毛利率",
                "利润",
                "成本",
                "算账",
                "定价",
                "退货率",
                "L3",
            ],
            "summary": (
                "单品真实毛利 = 售价 - 拿货成本 - 快递包材 - 平台扣点 - 运费险 - 退货摊销。"
                "真实毛利率 = 真实毛利 ÷ 售价；保本 ROI = 1 ÷ 真实毛利率。"
                "例如售价 100 元、综合成本 60 元，毛利率 40%，则保本 ROI = 1 ÷ 0.4 = 2.5；"
                "若计入 20% 退货率，有效保本 ROI 需提升至 2.5 ÷ (1 - 0.2) ≈ 3.13。"
            ),
            "key_points": [
                "真实毛利率 = (售价 - 拿货价 - 快递包材 - 平台佣金 - 运费险) ÷ 售价",
                "保本 ROI = 1 ÷ 真实毛利率（计入退货率时：有效保本 ROI = 保本 ROI ÷ (1 - 退货率)）",
                "新手测款安全线：建议单品毛利率 ≥ 40%（即保本 ROI ≤ 2.5）再开启付费投流",
            ],
            "source": "电商搞钱参谋核心方法论",
        },
        {
            "id": "kb_selection_method",
            "course_code": "EMC-CORE-02",
            "platform": "通用",
            "category": "蓝海选品",
            "level_id": "L2",
            "title": "新手低风险蓝海选品三步法（七分选品三分运营）",
            "keywords": [
                "选品",
                "蓝海",
                "货源",
                "1688",
                "一件代发",
                "爆款",
                "竞品",
                "差评",
                "拿货",
                "L2",
            ],
            "summary": (
                "1）痛点切入：找搜索热度上升但前排差评集中在『设计缺陷/赠品缺失/包装简陋』的细分词；"
                "2）毛利安全垫：零售价建议为 1688 拿货价的 2.2–3 倍以上，预留 45%+ 毛利空间；"
                "3）小步测款：优先谈支持一件代发且 48 小时包揽收的源头厂，先拿样实拍再上架。"
            ),
            "key_points": [
                "差评挖痛点：拆解竞品前50条中差评，把用户抱怨点变成自家主图第一卖点",
                "定价倍率：1688拿货价 × 2.5倍以上定零售价，确保扣除快递与损耗后仍有足够利润垫",
                "柔性供应链：冷启期严禁压货，优先选支持一件代发、48h揽收、可退换的产业带源头厂",
            ],
            "source": "电商搞钱参谋核心方法论",
        },
        {
            "id": "kb_cold_start",
            "course_code": "EMC-CORE-03",
            "platform": "通用",
            "category": "测款流量",
            "level_id": "L4",
            "title": "内容电商与搜索冷启动测款漏斗",
            "keywords": [
                "流量",
                "测款",
                "冷启动",
                "点击率",
                "转化率",
                "小红书",
                "抖音",
                "直通车",
                "千川",
                "L4",
            ],
            "summary": (
                "冷启动期严禁直接烧大预算：先用 3 组差异化首图/短视频测试前 500–1000 次曝光；"
                "若主图点击率 < 4%，说明痛点钩子不吸睛，需重做首图；"
                "若点击率 > 5% 但转化率 < 1.5%，需优化详情页前三屏卖点对比、买家秀与价格锚点。"
            ),
            "key_points": [
                "先测图再放量：准备3组不同痛点切角的主图/笔记封面做小预算AB测试",
                "点击率诊断：点击率 < 4% 立即换首图与标题钩子，切忌盲目追加广告预算",
                "转化率诊断：有点击无转化时，重点优化前3屏场景对比图、尺码表与首单保障评价",
            ],
            "source": "电商搞钱参谋核心方法论",
        },
        {
            "id": "kb_fulfillment_sop",
            "course_code": "EMC-CORE-04",
            "platform": "通用",
            "category": "履约售后",
            "level_id": "L5",
            "title": "履约发货与降低退货率/仅退款实操 SOP",
            "keywords": [
                "发货",
                "客服",
                "退货",
                "售后",
                "差评",
                "仅退款",
                "供应链",
                "断货",
                "履约",
                "L5",
            ],
            "summary": (
                "1）发货时效：绑定至少 1 家备用供应商防止爆单断货超时判罚；"
                "2）售前预期管理：把尺码偏大/色差提示写在详情页首屏与自动欢迎语中；"
                "3）售后拦截：包裹附赠售后保障卡，遇瑕疵优先小额补偿换好评，避免上升平台纠纷。"
            ),
            "key_points": [
                "双供应商备份：主推款必须备好第2家1688同款代发厂，严防断货导致延迟/虚假发货罚款",
                "售前把丑话说前面：自动回复配置尺码建议与材质说明，降低因预期不符导致的退货",
                "理性处理仅退款与差评：算清退货运费账，小额瑕疵主动发补偿红包拦截平台介入",
            ],
            "source": "电商搞钱参谋核心方法论",
        },
        {
            "id": "kb_verification_guide",
            "course_code": "EMC-CORE-05",
            "platform": "通用",
            "category": "六关认证",
            "level_id": "L1",
            "title": "正式经营成果认证与六关通关规则",
            "keywords": [
                "认证",
                "审核",
                "提交",
                "驳回",
                "证据",
                "附件",
                "通关",
                "草稿",
                "L1",
                "L6",
            ],
            "summary": (
                "教学模拟与正式经营成果严格分离：从沙盘复制或新建的成果初始均为 draft（草稿）；"
                "需在『正式经营成果』抽屉上传真实截图/表格证据（PNG/JPG/WEBP/PDF）并提交认证；"
                "小商审核 Agent 从结构完整性、数值自洽性、上下文一致性与证据相关性四维打分。"
            ),
            "key_points": [
                "草稿不等于通关：保存草稿后需绑定至少1份真实后台截图或表格证据再点击『提交认证』",
                "四维审核量表：结构完整性、L3毛利/保本ROI数值自洽性、跨关平台一致性、证据文件核验",
                "支持随时向小商询问『为什么被驳回』并获取逐项整改建议",
            ],
            "source": "电商搞钱参谋核心方法论",
        },
    ]


def build_xhs_items() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    csv_path = XHS_DIR / "课程总览.csv"
    text_dir = XHS_DIR / "课程文字"

    with open(csv_path, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    for row in rows:
        num = int(row["编号"])
        group = row["组别"].strip()
        title = row["课程名称"].strip()
        form = row["内容形态"].strip()
        fname = row["收录文件"].strip()
        if not fname or "未取得" in form:
            continue
        fpath = text_dir / fname
        if not fpath.is_file():
            continue

        raw = fpath.read_text(encoding="utf-8")
        curated = XHS_CURATED_SUMMARIES.get(num)
        if curated:
            category = curated["category"]
            level_id = curated["level_id"]
            summary = curated["summary"]
            key_points = curated["key_points"]
        else:
            # 去掉头部元信息行，提炼高信息密度正文
            body_lines = []
            for ln in raw.splitlines():
                s = ln.strip()
                if not s:
                    continue
                if s.startswith(
                    (
                        "来源：",
                        "课程：",
                        "编号：",
                        "内容类型：",
                        "课程ID：",
                        "时长：",
                        "讲师：",
                        "共",
                        "---",
                    )
                ):
                    continue
                if re.match(r"^={5,}$", s):
                    continue
                body_lines.append(s)
            cleaned_body = clean_text("\n".join(body_lines))
            if cleaned_body.startswith(title):
                cleaned_body = cleaned_body[len(title) :].strip(" ：:—-")
            summary = cleaned_body[:320] + ("…" if len(cleaned_body) > 320 else "")
            category = (
                "店铺直播"
                if "直播" in title or "店播" in title or "播" in title
                else (
                    "笔记运营"
                    if "笔记" in title or "热搜词" in title
                    else ("新商冷启" if "新商" in group or "冷启" in title else "小红书运营")
                )
            )
            level_id = infer_level_id(title, category, summary)
            key_points = extract_bullet_points(raw, summary)

        kws = extract_keywords(title, category, "小红书", [group, form], summary)
        items.append(
            {
                "id": f"xhs_course_{num:02d}",
                "course_code": f"XHS-{num:02d}",
                "platform": "小红书",
                "category": category,
                "level_id": level_id,
                "title": f"【小红书课程】{title}",
                "keywords": kws,
                "summary": summary,
                "key_points": key_points,
                "source": f"小红书电商学习中心 · {group}（编号{num}）",
            }
        )

    # 额外将《64_新商家百问百答.txt》中的 31 个高频 Q&A 拆分为独立精准问答卡
    faq_path = text_dir / "64_新商家百问百答.txt"
    if faq_path.is_file():
        faq_raw = faq_path.read_text(encoding="utf-8")
        blocks = re.split(r"\n(?=Q\d+[：:])", faq_raw)
        section_cat = "开店入驻"
        q_idx = 0
        for blk in blocks[1:]:
            q_idx += 1
            lines = [ln.strip() for ln in blk.strip().splitlines() if ln.strip()]
            if not lines:
                continue
            q_line = re.sub(r"^Q\d+[：:]\s*", "", lines[0]).strip()
            # 检查末尾是否带有下一节标题
            ans_lines = []
            next_sec = None
            for ln in lines[1:]:
                if re.match(r"^[1-5]\.\s*\S+相关问题", ln):
                    next_sec = ln
                else:
                    ans_lines.append(ln)
            ans_text = clean_text(" ".join(ans_lines))
            ans_text = re.sub(r"^答[：:]\s*", "", ans_text).strip()
            if not ans_text:
                continue

            lvl = infer_level_id(q_line, section_cat, ans_text)
            summary = ans_text[:300] + ("…" if len(ans_text) > 300 else "")
            kws = extract_keywords(
                q_line, "新商百问百答", "小红书", [section_cat, "百问百答", "FAQ"], summary
            )
            items.append(
                {
                    "id": f"xhs_faq_{q_idx:02d}",
                    "course_code": f"XHS-FAQ-{q_idx:02d}",
                    "platform": "小红书",
                    "category": "新商百问百答",
                    "level_id": lvl,
                    "title": f"【小红书百问百答】{q_line}",
                    "keywords": kws,
                    "summary": summary,
                    "key_points": extract_bullet_points("\n".join(ans_lines), summary),
                    "source": "小红书电商学习中心 · 《64_新商家百问百答》",
                }
            )
            if next_sec:
                section_cat = re.sub(r"^[1-5]\.\s*|\s*相关问题$", "", next_sec)

    return items


def build_pdd_items() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    raw_jsonl = PDD_DIR / "raw" / "courses.jsonl"
    merged_json = PDD_DIR / "_merged_list.json"
    md_root = PDD_DIR / "课程正文"

    merged_map: dict[int, dict[str, Any]] = {}
    if merged_json.is_file():
        for entry in json.loads(merged_json.read_text(encoding="utf-8")):
            if entry.get("id"):
                merged_map[int(entry["id"])] = entry

    courses_raw: dict[int, dict[str, Any]] = {}
    if raw_jsonl.is_file():
        with open(raw_jsonl, encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                obj = json.loads(line)
                if obj and obj.get("id"):
                    courses_raw[int(obj["id"])] = obj

    for md_file in sorted(md_root.rglob("*.md")):
        m_id = re.match(r"^(\d+)_", md_file.name)
        if not m_id:
            continue
        cid = int(m_id.group(1))
        raw_obj = courses_raw.get(cid, {})
        m_obj = merged_map.get(cid, {})

        category = md_file.parent.name
        title = (
            raw_obj.get("courseName") or m_obj.get("title") or md_file.stem.split("_", 1)[-1]
        ).strip()
        desc = (raw_obj.get("description") or "").strip()
        learners = str(raw_obj.get("readCountStr") or m_obj.get("learners") or "").strip()
        tags = raw_obj.get("tags") or m_obj.get("tags") or []
        if isinstance(tags, str):
            tags = [tags]

        md_text = md_file.read_text(encoding="utf-8")
        parts = md_text.split("## 课程正文")
        body_md = parts[1].strip() if len(parts) > 1 else ""
        cleaned_body = clean_text(body_md)

        # 过滤无实质正文的占位提示
        if cleaned_body.startswith(("（该课程无图文正文", "本课程为视频课", "本课程为直播课")):
            cleaned_body = ""

        if cleaned_body and len(cleaned_body) >= 40:
            summary_source = (
                f"{desc} {cleaned_body}".strip()
                if desc and desc not in cleaned_body[:100]
                else cleaned_body
            )
        elif desc:
            summary_source = clean_text(desc)
        else:
            summary_source = (
                f"拼多多商家课堂《{title}》（所属模块：{category}）。"
                f"涵盖 {title} 的商家后台操作路径、平台合规要求与常见问题解答。"
            )

        summary = summary_source[:300] + ("…" if len(summary_source) > 300 else "")
        lvl = infer_level_id(title, category, summary)
        kws = extract_keywords(title, category, "拼多多", list(tags), summary)
        key_points = extract_bullet_points(body_md or desc, summary)

        items.append(
            {
                "id": f"pdd_course_{cid}",
                "course_code": f"PDD-{cid}",
                "platform": "拼多多",
                "category": category,
                "level_id": lvl,
                "title": f"【拼多多课堂】{title}",
                "keywords": kws,
                "summary": summary,
                "key_points": key_points,
                "learners": learners,
                "source": f"拼多多课堂 · {category}（课程ID {cid}）",
            }
        )

    return items


def main() -> None:
    core_items = build_core_items()
    xhs_items = build_xhs_items()
    pdd_items = build_pdd_items()
    all_items = core_items + xhs_items + pdd_items

    by_platform: dict[str, int] = {}
    by_level: dict[str, int] = {}
    by_category: dict[str, int] = {}
    for item in all_items:
        p = item["platform"]
        lvl = item["level_id"]
        cat = item["category"]
        by_platform[p] = by_platform.get(p, 0) + 1
        by_level[lvl] = by_level.get(lvl, 0) + 1
        by_category[cat] = by_category.get(cat, 0) + 1

    payload = {
        "version": "2026.10.kb.v1",
        "source": "knowledge.zip（小红书电商课程知识库 + 拼多多新手开店知识库 + 电商搞钱参谋核心方法论）",
        "stats": {
            "total_items": len(all_items),
            "by_platform": by_platform,
            "by_level": dict(sorted(by_level.items())),
            "by_category": by_category,
        },
        "items": all_items,
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    size_kb = OUT_JSON.stat().st_size / 1024
    print(f"Built {OUT_JSON} ({size_kb:.1f} KB)")
    print("Stats:", json.dumps(payload["stats"], ensure_ascii=False))


if __name__ == "__main__":
    main()

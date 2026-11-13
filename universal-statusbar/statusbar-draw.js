// statusbar-draw.js — 通用状态栏绘图与立绘头像引擎
// 内置专业级实战插画导演提示词、正则解析器、图片上传与回写机制
// 支持：
// 1. OpenAI 兼容绘图 API (DALL-E 3 / FLUX / Midjourney) 及自动获取模型列表
// 2. 角色卡头像一键生成、本地图片上传、历史图库管理与即时切换
// 3. 自动正文绘图：每轮推演后自动触发，支持用户自定义 min~max 随机张数 roll 机制 (如 2~8 张)
// 4. 绘图上下文深度融合：自动提取并携带酒馆角色卡设、世界书条目、以及前序聊天记录
// 5. 提示词无污染隔离：插入 ![正文插图](...)，向后端发请求时自动剥离过滤
(function () {
  'use strict';

  if (window.STATUSBAR_DRAW) return;

  const store = () => window.STATUSBAR_STORE;
  const core = () => window.STATUSBAR_CORE;
  const db = () => window.STATUSBAR_DB_BRIDGE;

  /**
   * 专业级插画导演兼摄影指导完整提示词 (全量保留)
   */
  const DIRECTOR_REQUIREMENT_PROMPT = "你是一名专业插画导演兼摄影指导。阅读下方正文与角色资料块，在人物登场、动作交锋、情感转折、精彩或激情场景处挑选**最具画面感的瞬间**，为每张画面撰写结构化英文生图提示词。（张数以指令中给明的张数要求为准）\\\\n\\\\n选图优先级：①正文直接描写的影像（照片/镜中/屏幕上的画面）②动作与情感最浓烈的瞬间 ③人物登场、换装、互动的代表画面。多张图分散在正文前、中、后，禁止堆在同一段。\\\\n\\\\n## 一、主角出镜限制（最高优先级，覆盖其余规则的出镜要求）\\\\n主角＝你扮演的用户角色（角色资料块中的「主角」；正文以第一人称叙述时「我」即主角）。主角出镜严格按以下递降优先级执行，能满足上一级就不用下一级：\\\\n1. **主角不入镜**：默认主角完全不出现在画面中——优先其余角色单人/双人构图与环境空镜，此为最优方案；正文未直接描写主角的画面一律不带入主角。\\\\n2. **仅局部肢体**：仅当本图必须表现主角与他人的接触/互动（拥抱、牵手等无法回避）时，采用主角第一视角，只保留手/手臂等最小限度局部肢体入画（pov、hand、arm、head out of frame），躯干与面部不出现。\\\\n3. **无脸入镜**：仅当前两级都无法满足（必须展现主角躯干参与的画面）时才允许主角入画，且必须 faceless 或 from behind，绝不刻画主角的眼睛与五官。此为最后手段。\\\\n主角入画时露出的肢体（肤色/体型/毛发）与主角设定一致，不添加设定外的显著特征。主角不入镜时，控制词与角色块只写其余在场角色（solo/duo 等组合标签本身即排除主角，UC 不需要额外排斥主角）。其余角色（AI 角色/NPC）不受本条约束，按正文正常描绘。<UBS_think> 的人物清点须写明主角采用的出镜等级（不入镜/局部肢体/无脸）。\\\\n\\\\n## 二、导演构思流程（<UBS_think> 内用中文逐项执行）\\\\n每张图在 <UBS_think> 内按 S1~S9 逐项思考，每项一行、写明「来源→判断→结果」，禁止跳步、禁止写\"同上/略\"：\\\\n\\\\nS1 原文定格：本图对应的正文关键句「…」→ 画什么：谁、在哪、正在做什么；定格瞬间：动作进行到哪一帧、双方相对位置、此刻累积状态（衣物凌乱度/汗水/伤痕/手中持物）。图2起标前图承接（前图定格姿态→本图自然发展→不变项→累积递增）。\\\\nS2 分级：三问判定——有裸体（主要部位无衣物遮挡，内衣泳装不算）？有性器官露出（乳头/阴部/阴茎/肛门，仅乳沟臀缝不算）？有性行为（性交/口交/手淫/插入）？→ Safe（全否）/ R（有裸无器官）/ X（有器官或性行为）→ 分级开关：Safe 与 R 写 sfw，X 写 nsfw → 器官描述：仅 X 级按画面写（nipples/pussy/penis 等），Safe/R 不写任何器官词。每张独立判定，不沿用上一张。\\\\nS3 人物清点：画面实际人数 N=几？逐个列出（性别+身份+此刻着装与情绪）。正文在场且有戏份的角色必须入画（主角除外——主角按「一、主角出镜限制」判定入镜等级并写明）；正文没写的角色禁止凭空添加；纯背景路人一笔带过为 background figures；正文未给出外貌的临时配角用精简模板（1boy, faceless male, 体型, 核心动作）。N=1 必含 solo；N=2 必含 duo（或 hetero/yuri/yaoi）禁 solo；N≥3 用对应多人组合标签。\\\\nS4 主体与构图：先定主体类型（A角色美貌 / B动作 / C情感 / D魔法特效 / E服装 / F多人互动 / G视角冲击 / H身体局部 / I纯环境空镜，必须≠前图）→ 主体强调用具体措辞（A类 beautiful/stunning presence，C类 overwhelming ecstasy/desperate sorrow 等），UC 排斥其反义（plain/calm/emotionless）。再答构图三问：①摄像机在哪里（胸口高度/头顶俯拍/桌下/门缝/身后，禁止不假思索默认正面平视）②这是谁的眼睛（旁观者/对方/她本人）③什么角度能把主体核心放大（力量→仰拍/脆弱→俯拍/亲密→贴近/孤独→远景）→ 选定景别+视角+焦点词。禁止 front view + upper body + mid shot 三件套（=平庸证件照）。构图自洽：该角度看不见的部位（from behind 的表情、特写时的全身）不写、移入 UC；正文聚焦某身体局部→局部特写+对应 focus 词（breast focus/hand focus/leg focus…）；纯环境转场→无人物空镜（no humans，仅 Scene 行，无 Character 块）。连续两图主体类型、视角词、焦点词均不得相同。\\\\nS5 外貌核对→角色DNA句（逐角色逐项）：从角色资料块与前图 DNA 句抄录——锁定层（发色/发型签名含长度与刘海/瞳色/脸型/胸部/肤色/非人核心特征如兽耳尾巴角翅膀）必写；标志层（眼型/体型/身体标记如疤痕痣/标志性配饰）有则写；细节层（眉/睫/鼻/唇/肤质/年龄外观/普通配饰）画面相关则写。铁律：人数增加不降低单角色 DNA 完整度（N≥2 仍逐角色完整，不因人多而精简）。胸部等级（flat chest/small breasts/medium breasts/large breasts/huge breasts）跨图锁定不变、UC 排斥其他等级。同人/原创判定：Q1 角色名深度搜索（精确名/翻译名/部分名/昵称，任一命中 IP→同人，用 Danbooru 下划线标签如 hatsune_miku、rem_(re:zero)），标签后不重复模型已知外貌、只写与默认形象的差异项）；Q1 全未命中→原创，不加名条直接以 DNA 句开头（宁可多写完整描述也不编造标签）。正文明确变化（淋湿/受伤/换装/变身）→ DNA 句后追加变化项，不改动锁定层基础。→ 产出「角色DNA句」，跨图逐字重复同一句，禁止缩写/换词/漏项。多人场景脸型/眼型尽量互异（双人脸型必须不同）。\\\\nS6 服装核对（逐件）：此刻每件可见服装=颜色+款式+长度（裙/靴/袜/外套必带 mini/knee-length/thigh-high 等）+图案面料（有则写）+穿着状态（wet clothes/torn/disheveled/slipping off，正常不写）。衣物来源：正文优先，正文未细写时参照角色资料块的衣着（NPC=当前穿搭+上装/下装/内衣/袜子/鞋子/饰品分项，主角=衣柜穿搭基线）；正文明确描写换装/脱衣/整理衣衫时以正文为准。全裸→写 nude 不提取服装。禁裸词 dress/shirt/clothes/outfit——每件必带颜色与款式。内衣按可见性：外衣完整不透明→禁写内衣、UC 加 visible underwear；仅穿内衣无外衣→必写。跨图颜色一致：上一张 red dress 本张仍 red dress，直到正文明确换装。\\\\nS7 动作+表情+空间：每角色——姿势/身体朝向/双手各做一件事（一只手只能做一件事）。双人以上——接触点精确到部位（his right hand on her waist），主动方 source#动作、被动方 target#动作成对出现，每人空间位置（left/center/right + foreground/midground/background），互动双方面向彼此。动作相位：本图相位≥前图（蓄力→执行→命中→后果→余韵，同一动作序列内只进不退，新序列可重置）。身体接触物理自洽——先在脑中摆人偶：双方能否同时处于此姿势、这个角度手够得到。表情：视线方向+眼部（half-lidded/wide eyes/glazed）+嘴部（biting lip/parted lips/smirk）+生理（blush/sweat/trembling/tears）至少各一项，禁抽象词 happy/sad。两人共用道具状态必须一致（不能一方手持、另一方写道具落地）。\\\\nS8 负面清单（UC=负面提示词，告诉生图模型本图禁止出现什么，每张独立推导、不沿用上一张）：①防崩坏 bad face, poorly drawn face, distorted face, asymmetrical face（每角色必含）②防路人 background characters，多人加 fused bodies ③角色互斥：排斥他人发色/瞳色/服装主色（对方不入镜跳过互斥、同色系不互斥发色各自正面写清、禁止排斥性别词 male/female/1boy/1girl 会让角色消失）④构图不可见部位移入 UC ⑤分级：Safe/R 排斥 nsfw/nude/器官词，X 排斥 censored/mosaic/clothes ⑥胸部互斥其他等级。UC 只排除、不替代正向描述。\\\\nS9 最终检查：Scene（地点/时间/光源/氛围/构图）齐[已核对] Char（DNA句+服装+动作+表情）齐[已核对] UC（脸部防崩4词+分级+互斥）齐[已核对] 主体类型≠前图[已核对] 分级开关正确[已核对] 连续性（动作相位未回退/状态只增不减/空间位置有据/共用道具一致）[已核对]——任一不符回到对应 S步修正后再输出。\\\\n\\\\n多张图节奏：至少一张呈现核心角色清晰面容与表情（核心角色＝画面主体角色，通常为 AI 角色；神情是叙事核心，全背影/特写肢体等于丢掉神情。主角面容不在此列，见「一、主角出镜限制」）；无脸、背影与纯空镜合计不超过一半。\\\\n\\\\n## 三、生图提示词写法（image### 内，英文）\\\\nimage### 内的标签行结构、|centers 坐标、行序与行末分号见上方「输出结构契约」（不可更改）。下列细则只规定各字段**内容怎么写好**：\\\\n\\\\n写法细则：\\\\n1. 控制词永远最前：人数性别、分级开关（sfw/nsfw）；其余按「越重要越靠前」——主体强调紧跟其后、核心动作紧跟 DNA 句。\\\\n2. 角色DNA句（S5 产出）：一句连贯英文覆盖体型年龄+发型发色刘海+瞳色眼型+脸型+胸部+肤色+种族特征+标志性配饰。范例：a petite young woman with long waist-length black hair and blunt bangs, sharp almond-shaped amber eyes, a delicate oval face, small breasts, fair skin, and a black ribbon choker。跨图逐字重复，禁止缩写/换词/漏项——这是人物一致性的锚。\\\\n3. 分级与器官（S2）：Safe/R→sfw，服装完整描述、不写任何器官词；X→nsfw，全裸写 nude/completely naked 不提取服装，按画面写器官（nipples/pussy/penis 等）与性行为词（penetration/missionary 等）。\\\\n4. 同人/原创（S5）：同人用 Danbooru 下划线标签（hatsune_miku、rem_(re:zero)），标签后不重复模型已知外貌、只写差异项；不确定标签是否存在→按原创处理（宁可多写完整 DNA 也不编造标签）。原创不加名条，直接以 DNA 句开头。\\\\n5. 服装（S6）：每件独立短语、由内到外逐件列出：white pleated mini skirt, navy sailor uniform with white collar；衣物状态词跟随其后（wet clothes, slipping off one shoulder）。每件必带颜色与款式，禁裸词。\\\\n6. 动作（S7）：动词短语具体到部位与接触点（one hand gripping her wrist / fingers tangled in his hair），source#/target# 成对出现在互动双方；朝向写明（facing each other / looking back over shoulder）；禁止笼统的 interacting with each other。\\\\n7. 表情（S7）：视线+眼+嘴+生理至少各一项，紧跟动作之后。\\\\n8. 场景句（S4）：同一场景未切换时各图地点陈设保持一致，仅视角光影可变；正文切换场景后随正文更新。\\\\n9. UC（S8）：只排除不替代正向描述。\\\\n10. 禁止权重符号（{}、[]、::）——强调靠位置与措辞具体度表达。\\\\n11. 连续性：本图是上一张的下一帧——衣物凌乱/汗水/体液/伤痕只增不减（正文明确重置除外：整理衣衫/擦干/换装/休息后）；道具不凭空消失（前图手持的书，正文没写放下就还在手里）；动作相位只进不退。\\\\n12. 多人（N≥3）构图改 wide shot/中远景，每个实际角色仍独立成块完整 DNA 描述，只有真正群演归入 background figures。\\\\n\\\\n## 四、完整示例\\\\n### 示例1：SFW 单人背影（N=1）\\\\n<UBS_image>\\\\n<UBS_think>\\\\nS1 原文定格:「她背对着他站在窗边，指尖抵着冰凉的玻璃」→ 画什么：深夜卧室，少女独自立在窗前的背影；定格瞬间：指尖刚触上玻璃、肩带滑落一侧、肩膀微缩。\\\\nS2 分级:无裸体/无器官/无性行为→Safe→sfw→不写器官。\\\\nS3 人物清点:N=1，少女（睡裙、强自镇定的低落）；对话中的主角无画面动作，按主角出镜限制①不入镜→solo。\\\\nS4 主体与构图:主体=C情感（压抑孤独）；强调 quiet suppressed sadness，UC 排斥 calm/emotionless。构图三问：①摄像机室内床沿高度距三步 ②留在房门处男性的视线 ③背影+环抱放大孤独→full body, from behind，窗外冷色轮廓光。禁三件套否（from behind）。不可见：正面表情移 UC。\\\\nS5 外貌核对:设定=及腰黑长直+齐刘海/琥珀色杏眼/鹅蛋脸/纤瘦小胸/白皙/黑色缎带颈环→锁定层齐→DNA 句与前图逐字一致。原创（无 IP 匹配）不加名条。\\\\nS6 服装核对:淡蓝色过膝棉睡裙=pale blue knee-length cotton nightgown，肩带滑落一侧=strap slipping off one shoulder；赤足。\\\\nS7 动作+表情+空间:站姿背对镜头居中；右手指尖抵窗玻璃，左臂环抱自己手肘；朝向 from behind。表情：侧头微垂望窗外雨幕，half-lidded，唇线抿直，quiet suppressed sadness。无强生理反应。\\\\nS8 负面:bad face, poorly drawn face, distorted face, asymmetrical face；background characters；eyes visible from behind, facial expression（背影不可见）；extra fingers；nsfw, nude（Safe 级排斥）。\\\\nS9 最终检查:Scene 齐[已核对] Char 齐[已核对] UC 齐[已核对] 主体=C≠前图[已核对] sfw[已核对] 连续性起始帧[已核对]\\\\n</UBS_think>\\\\nposition: 她背对着他站在窗边，指尖抵着冰凉的玻璃，久久没有回头。\\\\ndesc: 深夜卧室，黑长直少女背对镜头立于窗前，指尖轻触雨幕玻璃，睡裙肩带滑落一侧。\\\\n\\\\nimage###\\\\nScene Composition: 1girl, solo, sfw, a quiet bedroom at midnight, rain streaming down the tall window with faint city lights beyond the glass, cold rim light tracing her silhouette, melancholic and still atmosphere, full body, medium long shot, from behind;\\\\nCharacter 1 Prompt: 1girl, a petite young woman with long waist-length straight black hair and blunt bangs, sharp almond-shaped amber eyes, a delicate oval face, small breasts, fair skin, and a black ribbon choker, pale blue knee-length cotton nightgown with the strap slipping off one shoulder, barefoot, standing with her back to the viewer at the window, right fingertip pressed against the cold glass, left arm wrapped around her own elbow, head slightly bowed toward the rainy night, half-lidded eyes, lips pressed thin, quiet suppressed sadness|centers:C3;\\\\nCharacter 1 UC: bad face, poorly drawn face, distorted face, asymmetrical face, background characters, eyes visible from behind, facial expression, extra fingers, nsfw, nude;###\\\\n</UBS_image>\\\\n\\\\n### 示例2：SFW 双人互动（N=2，展示 source-target / UC 互斥）\\\\n<UBS_image>\\\\n<UBS_think>\\\\nS1 原文定格:「她凑过去伸出食指戳了戳他的脸颊，笑得眉眼弯弯」→ 画什么：图书馆窗边，粉发少女靠在黑发青年肩上伸手戳他脸；定格瞬间：指尖刚触上脸颊、青年微侧头、少女憋笑。\\\\nS2 分级:无裸无器官无行为→Safe→sfw。\\\\nS3 人物清点:N=2→duo, 1girl and 1boy。少女 A（粉长发、便装、调皮）、青年 B（黑短发、衬衫、无奈），两人均为剧情角色（非主角），按正文正常入画。\\\\nS4 主体与构图:主体=F多人互动；强调 playful intimate interaction。构图三问：①摄像机长椅侧面距两步、齐胸高 ②旁观者视角 ③贴近放大互动亲昵→medium shot, from side。禁三件套否（from side）。两人面向彼此。\\\\nS5 外貌核对:A=及腰粉直发+空气刘海/绿瞳/圆脸/小胸/白皙→DNA 句；B=黑色短碎发/灰瞳/方下颌/中等体型/小麦色→DNA 句。两人原创无 IP。脸型互异（圆脸 vs 方下颌）。\\\\nS6 服装核对:A=白色棉质吊带裙 white cotton spaghetti-strap dress, knee-length；B=浅灰亚麻衬衫 light grey linen shirt, sleeves rolled up，黑色长裤 black trousers。\\\\nS7 动作+表情+空间:A 靠在 B 右肩、右手食指戳 B 左颊（source#poking cheek）、facing right、左位前景；B 坐姿微侧头、左手持书、target#being poked on cheek、facing left、右位。接触点=食指触左颊。表情：A 眉眼弯弯 grinning eyes、slight blush；B 微蹙 slightly furrowed brows、wry smile。\\\\nS8 负面:A UC 排斥 B 发色瞳色脸型+防崩+防融合；B UC 排斥 A 发色瞳色脸型+防崩+防融合。互斥只排外貌特征，禁排性别词。\\\\nS9 最终检查:Scene 齐[已核对] Char1/Char2 齐[已核对] UC 互斥齐[已核对] 主体=F≠前图[已核对] sfw[已核对] 连续性[已核对]\\\\n</UBS_think>\\\\nposition: 她凑过去伸出食指戳了戳他的脸颊，笑得眉眼弯弯。\\\\ndesc: 午后图书馆窗边，粉发少女倚在黑发青年肩头，伸手轻戳他的脸颊，笑得眉眼弯弯。\\\\n\\\\nimage###\\\\nScene Composition: 1girl and 1boy, duo, sfw, a library reading nook by a tall window, afternoon sunlight casting warm rectangles on wooden floor, two cushioned chairs side by side, peaceful and playful atmosphere, medium shot, from side;\\\\nCharacter 1 Prompt: 1girl, a young woman with long waist-length pink hair and airy bangs, round green eyes, a round face, small breasts, fair skin, white cotton spaghetti-strap dress knee-length, leaning on his right shoulder, right index finger poking his left cheek, grinning eyes, slight blush, facing right, source#poking cheek|centers:C2;\\\\nCharacter 1 UC: bad face, poorly drawn face, distorted face, asymmetrical face, background characters, fused bodies, black hair, grey eyes, square jaw;\\\\nCharacter 2 Prompt: 1boy, a young man with short messy black hair, grey eyes, a square jaw, medium build, light tan skin, light grey linen shirt with sleeves rolled up, black trousers, sitting with head slightly turned, left hand holding an open book, slightly furrowed brows, wry smile, facing left, target#being poked on cheek|centers:D2;\\\\nCharacter 2 UC: bad face, poorly drawn face, distorted face, asymmetrical face, background characters, fused bodies, pink hair, green eyes, round face;###\\\\n</UBS_image>";

  // 正则体系
  const REG_IMAGE_BLOCK = /<(?:UBS_image|image)>([\s\S]*?)(?:<\/(?:UBS_image|image)>|<\\(?:UBS_image|image)>|$)/gi;
  const REG_THINK = /<(?:UBS_think|imgthink)>([\s\S]*?)(?:<\/(?:UBS_think|imgthink)>|<\\(?:UBS_think|imgthink)>|$)/i;
  const REG_POS_LINE = /position\s*[:：]\s*([^\n\r]+)/i;
  const REG_DESC_LINE = /desc\s*[:：]\s*([^\n\r]+)/i;
  const REG_IMG_HASH = /image#{2,}([\s\S]*?)#{2,}/i;
  const REG_POS_TAG = /<position>([\s\S]*?)(?:<\/position>|<\\position>|$)/i;
  const REG_DESC_TAG = /<desc>([\s\S]*?)(?:<\/desc>|<\\desc>|$)/i;
  const REG_PROMPT_TAG = /<prompt>([\s\S]*?)(?:<\/prompt>|<\\prompt>|$)/i;

  function cleanPromptText(e) {
    let t = String(e || '').replace(/，/g, ',').replace(/；/g, ';').replace(/：/g, ':').replace(/。/g, '.').replace(/《/g, '<').replace(/》/g, '>');
    t = t.replace(/\bBREAK\b/g, ' BREAK ');
    t = t.replace(/\s+/g, ' ').trim();
    t = t.replace(/\s*;\s*/g, '; ').replace(/;\s*$/g, '');
    return t.trim();
  }

  function cleanDesc(e) {
    return String(e || '').trim().replace(/^["'「『]|["'」』]$/g, '').replace(/\s+/g, ' ');
  }

  /**
   * 输出解析器：从 AI 回复中严格提取 <UBS_image> 结构块 (严禁任何私自截断，全量提取所有有效块)
   */
  function parseImageBlocks(aiOutput) {
    const cleanOutput = String(aiOutput || '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    const results = [];
    let match;
    REG_IMAGE_BLOCK.lastIndex = 0;
    while ((match = REG_IMAGE_BLOCK.exec(cleanOutput)) !== null) {
      const block = match[1] || '';

      const thinkMatch = block.match(REG_THINK);
      const think = thinkMatch ? (thinkMatch[1] || '').trim() : '';
      const contentWithoutThink = thinkMatch ? block.replace(thinkMatch[0], '') : block;

      const posMatch = contentWithoutThink.match(REG_POS_LINE) || contentWithoutThink.match(REG_POS_TAG);
      const promptMatch = contentWithoutThink.match(REG_IMG_HASH) || contentWithoutThink.match(REG_PROMPT_TAG);
      const descMatch = contentWithoutThink.match(REG_DESC_LINE) || contentWithoutThink.match(REG_DESC_TAG);

      if (!promptMatch) continue;

      let posQuote = posMatch ? (posMatch[1] || '').trim() : '';
      posQuote = posQuote.replace(/^["'「『]|["'」』]$/g, '').trim();

      const rawPrompt = (promptMatch[1] || '').trim();
      const cleaned = cleanPromptText(rawPrompt);
      if (!cleaned) continue;
      if (cleaned.includes('场景环境与构图光影') || cleaned.includes('场景行...')) continue;

      const desc = descMatch ? cleanDesc(descMatch[1]) : '';

      results.push({
        think,
        positionQuote: posQuote,
        description: desc,
        promptText: cleaned,
        rawBlock: block
      });
    }
    return results;
  }

  /**
   * 获取 SillyTavern 酒馆全局上下文（安全容灾探测）
   */
  /**
   * 剥离正文插图标签 (防提示词污染)
   */
  /**
   * 规范化 API Base URL
   */
  function normalizeBaseUrl(url) {
    let u = String(url || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) {
      u = 'https://' + u;
    }
    return u;
  }

  function stripStoryImages(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .split('\n')
      .filter(line => !line.includes('![正文插图](') && !line.includes('![插图]('))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function getTavernContext() {
    const candidates = [
      () => (typeof SillyTavern !== 'undefined' ? (typeof SillyTavern.getContext === 'function' ? SillyTavern.getContext() : SillyTavern) : null),
      () => (window.SillyTavern ? (typeof window.SillyTavern.getContext === 'function' ? window.SillyTavern.getContext() : window.SillyTavern) : null),
      () => (window.parent?.SillyTavern ? (typeof window.parent.SillyTavern.getContext === 'function' ? window.parent.SillyTavern.getContext() : window.parent.SillyTavern) : null),
      () => (window.TavernHelper?.SillyTavern ? (typeof window.TavernHelper.SillyTavern.getContext === 'function' ? window.TavernHelper.SillyTavern.getContext() : window.TavernHelper.SillyTavern) : null)
    ];

    for (const getter of candidates) {
      try {
        const ctx = getter();
        if (ctx && (ctx.chat || ctx.characters || ctx.characterId !== undefined)) {
          return ctx;
        }
      } catch (e) { }
    }
    return null;
  }

  /**
   * 获取最近聊天记录 (兼容 TavernHelper / SillyTavern.chat / DOM 消息楼层)
   */
  function getRecentChatMessages(count = 8) {
    // 1. 优先使用 TavernHelper.getChatMessages
    try {
      const th = window.TavernHelper || window.parent?.TavernHelper;
      if (th && typeof th.getChatMessages === 'function') {
        const lastId = typeof th.getLastMessageId === 'function' ? th.getLastMessageId() : -1;
        if (typeof lastId === 'number' && lastId >= 0) {
          const range = `${Math.max(0, lastId - count + 1)}-${lastId}`;
          const msgs = th.getChatMessages(range, { hide_state: 'all', include_swipes: false });
          if (Array.isArray(msgs) && msgs.length > 0) {
            return msgs.map(m => {
              const role = m.is_user || m.role === 'user' ? '用户' : (m.name || 'AI');
              const txt = stripStoryImages(m.mes || m.message || '').replace(/<[^>]+>/g, '').trim();
              return `${role}: ${txt}`;
            }).filter(t => t && !t.endsWith(':'));
          }
        }
      }
    } catch (e) { }

    // 2. 检查 ctx.chat 或 SillyTavern.chat
    try {
      const ctx = getTavernContext();
      const chat = ctx?.chat || window.SillyTavern?.chat || window.parent?.SillyTavern?.chat;
      if (Array.isArray(chat) && chat.length > 0) {
        const slice = chat.slice(-count);
        return slice.map(m => {
          const role = m.is_user ? '用户' : (m.name || 'AI');
          const txt = stripStoryImages(m.mes || m.message || '').replace(/<[^>]+>/g, '').trim();
          return `${role}: ${txt}`;
        }).filter(t => t && !t.endsWith(':'));
      }
    } catch (e) { }

    // 3. 回退：DOM 实时解析 #chat 楼层
    try {
      const doc = window.parent?.document || document;
      const mesEls = Array.from(doc.querySelectorAll('#chat > .mes[mesid]')).slice(-count);
      if (mesEls.length > 0) {
        return mesEls.map(el => {
          const isUser = el.getAttribute('is_user') === 'true';
          const name = el.querySelector('.ch_name .name')?.textContent?.trim() || (isUser ? '用户' : 'AI');
          const mesTxt = el.querySelector('.mes_text')?.textContent?.trim() || '';
          return `${name}: ${stripStoryImages(mesTxt).replace(/<[^>]+>/g, '').trim()}`;
        }).filter(t => t && !t.endsWith(':'));
      }
    } catch (e) { }

    return [];
  }

  /**
   * 1. 提取角色卡专属的全部世界书与人设设定条目 (终极健壮版：支持 Promise/字典/数组/外部绑定高优覆盖)
   */
  async function getCharacterCardBlueLightWorldbook() {
    const seenContent = new Set();
    const entryMap = new Map();

    function addEntry(comment, content, priority = 1) {
      if (!content || typeof content !== 'string') return;
      const trimmed = content.trim();
      if (!trimmed) return;
      const cleanComment = (comment || '角色卡设定').trim();

      if (seenContent.has(trimmed)) return;

      if (entryMap.has(cleanComment)) {
        const existing = entryMap.get(cleanComment);
        if (priority > existing.priority || (priority === existing.priority && trimmed.length >= existing.content.length)) {
          seenContent.delete(existing.content);
          seenContent.add(trimmed);
          entryMap.set(cleanComment, { comment: cleanComment, content: trimmed, priority });
        }
        return;
      }

      seenContent.add(trimmed);
      entryMap.set(cleanComment, { comment: cleanComment, content: trimmed, priority });
    }

    function parseEntriesContainer(container, priority = 2) {
      if (!container) return;
      let list = [];
      if (Array.isArray(container)) {
        list = container;
      } else if (container.entries) {
        list = Array.isArray(container.entries) ? container.entries : Object.values(container.entries);
      } else if (typeof container === 'object') {
        list = Object.values(container);
      }

      for (const e of list) {
        if (!e || typeof e !== 'object' || e.enabled === false || e.disable === true) continue;
        const comment = e.comment || (Array.isArray(e.keys) ? e.keys.join('/') : e.key) || e.name || '世界书设定';
        const content = e.content || e.entry || e.text || '';
        addEntry(comment, content, priority);
      }
    }

    try {
      const ctx = getTavernContext();
      const curChar = ctx?.characters?.[ctx?.characterId] || window.characters?.[window.characterId];
      const th = window.TavernHelper || window.parent?.TavernHelper;

      // 1. 角色卡绑定的全部外部世界书 (Highest Priority = 3)
      const linkedBookNames = [];
      const worldExt = curChar?.data?.extensions?.world || curChar?.world;
      if (worldExt && typeof worldExt === 'string') linkedBookNames.push(worldExt);
      if (typeof th?.getCharWorldbookNames === 'function') {
        try {
          const names = th.getCharWorldbookNames('current');
          if (names?.primary) linkedBookNames.push(names.primary);
          if (Array.isArray(names?.additional)) linkedBookNames.push(...names.additional);
        } catch (e) { }
      }

      const getWbFunc = th?.getWorldbook || ctx?.getWorldbook;
      for (const bName of linkedBookNames) {
        try {
          if (typeof getWbFunc === 'function') {
            const res = await getWbFunc(bName);
            parseEntriesContainer(res, 3);
          }
        } catch (e) { }
      }

      // 2. 酒馆全局世界书 (Priority = 2)
      const globalWorldSources = [
        ctx?.worldInfo,
        ctx?.world_info,
        window.world_info,
        window.parent?.world_info,
        window.world_info_cache
      ];
      for (const src of globalWorldSources) {
        if (src) parseEntriesContainer(src, 2);
      }

      // 3. 角色卡直接内嵌的 character_book (Priority = 1)
      const embeddedBook = curChar?.data?.character_book || curChar?.character_book;
      if (embeddedBook) {
        parseEntriesContainer(embeddedBook, 1);
      }
    } catch (err) {
      console.warn('[状态栏绘图] 提取角色卡世界书失败:', err);
    }

    const results = [];
    for (const item of entryMap.values()) {
      results.push(`【${item.comment}】\n${item.content}`);
    }
    return results.join('\n\n');
  }

  // 提取信息表的所有在场角色的内容 (主角信息表 + 角色信息表全量字段，不截断，零压缩)
  function getAllPresentCharacterStates(targetCharName = '') {
    const bridge = db();
    const sections = [];

    if (bridge) {
      // 1. 主角信息表
      try {
        const proRows = bridge.getAllRows('主角信息表') || [];
        if (proRows.length > 0) {
          const p = proRows[0];
          const lines = [];
          for (const [k, v] of Object.entries(p)) {
            if (v != null && String(v).trim() && !k.startsWith('_')) {
              lines.push(`${k}：${v}`);
            }
          }
          sections.push(`【主角（我 / 用户角色）】\n${lines.join('\n')}`);
        } else {
          const snapPro = window.STATUSBAR_CORE?.getProtagonistState?.() || window.STATUSBAR_CORE?.getFullSnapshot?.()?.protagonist || window.STATUSBAR?.getSnapshot?.()?.protagonist;
          if (snapPro) {
            const lines = [];
            for (const [k, v] of Object.entries(snapPro)) {
              if (v != null && String(v).trim() && !k.startsWith('_') && typeof v !== 'object') {
                lines.push(`${k}：${v}`);
              }
            }
            if (lines.length > 0) {
              sections.push(`【主角（我 / 用户角色）】\n${lines.join('\n')}`);
            }
          }
        }
      } catch (e) { }

      // 2. 角色信息表 (全新数据库)
      try {
        let charRows = [];
        const allCharsTable = bridge.getAllRows('角色信息表') || [];
        if (allCharsTable.length > 0) {
          charRows = allCharsTable.filter(c => {
            const str = String(c['是否在场'] ?? '').trim();
            const isPresent = str === '1';
            const name = String(c['姓名'] || '').trim();
            return isPresent || (targetCharName && name === targetCharName);
          });
        }

        let hasTarget = false;
        const seenCharNames = new Set();

        for (const c of charRows) {
          const name = String(c.name || '').trim();
          if (!name || seenCharNames.has(name)) continue;
          seenCharNames.add(name);
          if (targetCharName && name === targetCharName) hasTarget = true;
          const lines = [];
          for (const [k, v] of Object.entries(c)) {
            if (v != null && String(v).trim() && !k.startsWith('_')) {
              lines.push(`${k}：${v}`);
            }
          }
          sections.push(`【在场角色：${name}】\n${lines.join('\n')}`);
        }

        // 若目标角色不在列表中，从角色信息表全量补齐
        if (targetCharName && !hasTarget) {
          const rows = bridge.getAllRows('角色信息表') || [];
          const found = rows.find(r => (r['姓名'] || '').trim() === targetCharName);
          if (found && !seenCharNames.has(targetCharName)) {
            seenCharNames.add(targetCharName);
            const lines = [];
            for (const [k, v] of Object.entries(found)) {
              if (v != null && String(v).trim() && !k.startsWith('_')) {
                lines.push(`${k}：${v}`);
              }
            }
            sections.push(`【指定生成角色：${targetCharName}】\n${lines.join('\n')}`);
          }
        }
      } catch (e) { }
    }

    return sections.join('\n\n') || '（暂无在场角色数据）';
  }

  /**
   * 仅提取酒馆“仅影响显示 (markdownOnly)”正则过滤后的前端正文内容
   * 酒馆 script.js 中 messageFormatting 时的调用逻辑：
   * getRegexedString(mes, regex_placement.AI_OUTPUT, { isMarkdown: true })
   */
  async function applySillyTavernDisplayRegex(rawText, options = {}) {
    if (!rawText || typeof rawText !== 'string') return '';
    let result = rawText;

    // 方案 1: 优先动态导入酒馆官方正则引擎 /scripts/extensions/regex/engine.js
    try {
      const engine = await import('/scripts/extensions/regex/engine.js');
      if (engine && typeof engine.getRegexedString === 'function') {
        const placement = engine.regex_placement?.AI_OUTPUT ?? 2;
        const depth = options.depth !== undefined ? options.depth : 0;
        let charOverride = options.characterOverride;
        if (!charOverride && options.mesId !== undefined) {
          const ctx = getTavernContext();
          const chat = ctx?.chat || window.SillyTavern?.chat || window.parent?.SillyTavern?.chat;
          if (Array.isArray(chat) && chat[options.mesId]?.name) {
            charOverride = chat[options.mesId].name;
          }
        }
        if (!charOverride) {
          const ctx = getTavernContext();
          charOverride = ctx?.characterName || window.characters?.[window.this_chid]?.name || undefined;
        }

        // isMarkdown: true 严格过滤并只执行酒馆「仅影响显示 (markdownOnly)」的正则规则
        const regexed = engine.getRegexedString(rawText, placement, {
          isMarkdown: true,
          characterOverride: charOverride,
          depth: depth
        });
        if (typeof regexed === 'string') {
          return regexed;
        }
      }
    } catch (e) {
      // 动态导入不可用时，平滑降级到方案 2
    }

    // 方案 2: 原生解析酒馆全局、角色卡与预设中内置的所有「仅影响显示 (markdownOnly)」正则脚本并执行
    try {
      const ctx = getTavernContext();
      const globalScripts = ctx?.extensionSettings?.regex
        || window.extension_settings?.regex
        || window.parent?.extension_settings?.regex
        || [];
      const chid = ctx?.characterId ?? window.this_chid ?? window.parent?.this_chid;
      const chars = ctx?.characters ?? window.characters ?? window.parent?.characters;
      const scopedScripts = chars?.[chid]?.data?.extensions?.regex_scripts || [];
      const presetScripts = ctx?.presetManager?.readPresetExtensionField?.({ path: 'regex_scripts' }) || [];
      const allScripts = [
        ...(Array.isArray(globalScripts) ? globalScripts : []),
        ...(Array.isArray(scopedScripts) ? scopedScripts : []),
        ...(Array.isArray(presetScripts) ? presetScripts : [])
      ];

      for (const script of allScripts) {
        if (!script || script.disabled) continue;
        // 关键条件：严格只提取酒馆设定为「仅影响显示」的正则 (markdownOnly / only_format_display)
        const isDisplayOnly = !!(script.markdownOnly || script.only_format_display);
        const isAiOutput = !script.placement || script.placement.includes(2);
        if (isDisplayOnly && isAiOutput && script.findRegex) {
          try {
            let regex = null;
            const m = script.findRegex.match(/^\/(.+)\/([a-z]*)$/is);
            if (m) {
              regex = new RegExp(m[1], m[2]);
            } else {
              regex = new RegExp(script.findRegex, 'gi');
            }
            const replaceStr = (script.replaceString != null ? String(script.replaceString) : '').replace(/{{match}}|\$0/gi, '$$&');
            result = result.replace(regex, replaceStr);
          } catch (err) {
            console.warn('[statusbar-draw] 执行单条酒馆显示正则异常:', script.scriptName, err);
          }
        }
      }
      return result;
    } catch (e) {
      console.warn('[statusbar-draw] 提取酒馆正则脚本失败:', e);
    }

    // 方案 3: 从前端 DOM 中提取已渲染完成的内容 (纯正前端呈现)
    if (options.mesId !== undefined) {
      try {
        const doc = window.parent?.document || document;
        const mesEl = doc.querySelector(`#chat > .mes[mesid="${options.mesId}"] .mes_text`);
        if (mesEl) {
          const domHtml = mesEl.innerHTML || '';
          if (domHtml.trim()) return domHtml;
        }
      } catch (e) { }
    }

    return result;
  }

  /**
   * 规范化标签格式（如用户输入 con 自动规范化为 <con> 或 </con>，带尖括号则原样保留）
   */
  function normalizeTagPattern(tag, isClosing = false) {
    if (!tag || typeof tag !== 'string') return '';
    tag = tag.trim();
    if (!tag) return '';
    if (!tag.includes('<') && !tag.includes('>')) {
      return isClosing ? `</${tag}>` : `<${tag}>`;
    }
    return tag;
  }

  /**
   * 定位并提取用户设定标签范围 (<xx> ... </xx>) 在完整正文中的前后边界与内部正文
   * 严格契约：正文插图只能且必须插入在用户设定的 <xx></xx> 内部！
   */
  function findTargetTagRangeInStory(text) {
    if (!text || typeof text !== 'string') return null;
    const s = store()?.getSettings() || {};
    const sTagRaw = (s.storyExtractStartTag || '').trim();
    const eTagRaw = (s.storyExtractEndTag || '').trim();

    // 如果用户完全未配置提取标签，整篇文本均为正文
    if (!sTagRaw && !eTagRaw) {
      return null;
    }

    const sTag = normalizeTagPattern(sTagRaw, false);
    let startTagStart = 0;
    let innerStart = 0;

    // 1. 匹配起始标签
    if (sTag) {
      const sPattern = sTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const sRegex = new RegExp(sPattern, 'i');
      const m = text.match(sRegex);
      if (!m || m.index === undefined) {
        console.warn(`[状态栏绘图] 正文中未匹配到配置的起始标签 "${sTag}"`);
        return null;
      }
      startTagStart = m.index;
      innerStart = m.index + m[0].length;
    }

    // 2. 匹配结束标签
    const textAfterStart = text.slice(innerStart);
    let endCandidates = [];
    if (eTagRaw) {
      endCandidates = eTagRaw.split(/[,|\n]+/).map(t => normalizeTagPattern(t, true)).filter(Boolean);
    } else if (sTag) {
      const tagMatch = sTag.match(/<([a-zA-Z0-9_\-]+)>/);
      if (tagMatch) {
        endCandidates.push(`</${tagMatch[1]}>`);
      }
    }

    let minEndRelIdx = -1;
    for (const et of endCandidates) {
      const etPattern = et.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const eRegex = new RegExp(etPattern, 'i');
      const em = textAfterStart.match(eRegex);
      if (em && em.index !== undefined) {
        if (minEndRelIdx === -1 || em.index < minEndRelIdx) {
          minEndRelIdx = em.index;
        }
      }
    }

    let innerEnd = text.length;
    if (minEndRelIdx !== -1) {
      innerEnd = innerStart + minEndRelIdx;
    }

    return {
      before: text.slice(0, innerStart), // 包含起始标签（如 <con>）及之前的所有内容
      inner: text.slice(innerStart, innerEnd), // <con> 与 </con> 之间的纯正文核心
      after: text.slice(innerEnd) // 包含结束标签（如 </con>）及之后的所有内容
    };
  }

  /**
   * 根据用户配置的起始与结束标签，提取指定标签范围内的纯正文剧情
   * 支持如：<content> 内容 </content> 或 <content> 内容 </UpdateVariable>
   * 若配置为空，则全量提取全部正文
   */
  function extractTaggedStoryContent(text, startTag = '', endTag = '') {
    if (!text || typeof text !== 'string') return '';
    const s = store()?.getSettings() || {};
    const sTagRaw = (startTag !== undefined && startTag !== '' ? startTag : (s.storyExtractStartTag || '')).trim();
    const eTagRaw = (endTag !== undefined && endTag !== '' ? endTag : (s.storyExtractEndTag || '')).trim();

    // 如果未配置标签，全量提取全部正文
    if (!sTagRaw && !eTagRaw) {
      return text.trim();
    }

    const sTag = normalizeTagPattern(sTagRaw, false);
    let startIndex = 0;
    let afterStartOffset = 0;

    // 1. 匹配起始标签 (例如 <con> 或 <content>)
    if (sTag) {
      const sTagPattern = sTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const sRegex = new RegExp(sTagPattern, 'i');
      const sMatch = text.match(sRegex);
      if (sMatch && sMatch.index !== undefined) {
        startIndex = sMatch.index;
        afterStartOffset = sMatch.index + sMatch[0].length;
      } else {
        // 如果配置了起始标签但原文中未匹配到，安全回退全量提取
        return text.trim();
      }
    }

    // 2. 匹配结束标签 (例如 </con> 或 </UpdateVariable>，支持多选以逗号或|分隔)
    const textAfterStart = text.slice(afterStartOffset);
    let endCandidates = [];

    if (eTagRaw) {
      endCandidates = eTagRaw.split(/[,|\n]+/).map(t => normalizeTagPattern(t, true)).filter(Boolean);
    } else if (sTag) {
      // 若只填了起始标签（如 <con>），自动推导对应闭合标签（如 </con>）
      const tagMatch = sTag.match(/<([a-zA-Z0-9_\-]+)>/);
      if (tagMatch) {
        endCandidates.push(`</${tagMatch[1]}>`);
      }
    }

    let minEndRelativeIdx = -1;
    let matchEndLength = 0;

    for (const et of endCandidates) {
      const etPattern = et.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const eRegex = new RegExp(etPattern, 'i');
      const eMatch = textAfterStart.match(eRegex);
      if (eMatch && eMatch.index !== undefined) {
        if (minEndRelativeIdx === -1 || eMatch.index < minEndRelativeIdx) {
          minEndRelativeIdx = eMatch.index;
          matchEndLength = eMatch[0].length;
        }
      }
    }

    let endIndex = text.length;
    if (minEndRelativeIdx !== -1) {
      // 截取到结束标签末尾，完整提取包含 <con> ... </con> 结构块
      endIndex = afterStartOffset + minEndRelativeIdx + matchEndLength;
    }

    const extracted = text.slice(startIndex, endIndex).trim();
    return extracted || text.trim();
  }

  /**
   * 3. 自动从酒馆聊天记录中获取最新一条 AI 消息元信息
   */
  function getLatestAiMessageInfo() {
    try {
      const ctx = getTavernContext();
      const chat = ctx?.chat || window.SillyTavern?.chat || window.parent?.SillyTavern?.chat;
      if (Array.isArray(chat) && chat.length > 0) {
        for (let i = chat.length - 1; i >= 0; i--) {
          const m = chat[i];
          if (m && !m.is_user && !m.is_system && m.mes) {
            return { mesId: i, rawMes: m.mes };
          }
        }
      }
      const doc = window.parent?.document || document;
      const mesEls = Array.from(doc.querySelectorAll('#chat > .mes[mesid]')).reverse();
      for (const el of mesEls) {
        if (el.getAttribute('is_user') !== 'true' && el.getAttribute('is_system') !== 'true') {
          const id = el.getAttribute('mesid');
          const txt = el.querySelector('.mes_text')?.textContent || '';
          return { mesId: id !== null ? parseInt(id, 10) : undefined, rawMes: txt };
        }
      }
    } catch (e) { }
    return { mesId: undefined, rawMes: '' };
  }

  /**
   * 提取最新一条 AI 正文 (自动先经过酒馆仅影响显示正则，再经标签提取)
   */
  async function getLatestAiStoryText() {
    return await getCleanStoryText('');
  }

  /**
   * 4. 清洗正文剧情
   * 管线：1. 执行酒馆“仅影响显示”正则 -> 2. 按设定范围提取 <xxx> </xxx> 纯正文 (空则全量) -> 3. 剥离插图与思考标记
   */
  async function getCleanStoryText(rawText = '', options = {}) {
    let t = rawText;
    let mesId = options.mesId;

    if (!t || typeof t !== 'string' || !t.trim()) {
      const latestInfo = getLatestAiMessageInfo();
      t = latestInfo.rawMes || '';
      if (mesId === undefined) mesId = latestInfo.mesId;
    }
    if (!t || !t.trim()) return '（当前暂无最新剧情正文）';

    // 步骤 1: 仅提取酒馆“仅影响显示 (markdownOnly)”正则过滤后的前端内容
    const regexedText = await applySillyTavernDisplayRegex(t, { mesId, ...options });

    // 步骤 2: 按设定标签范围提取纯正文 (如 <content> ... </content> 或 </UpdateVariable>，空则全量)
    const taggedText = extractTaggedStoryContent(regexedText);

    // 步骤 3: 剥离插图标签与可能混杂的思考/代码块
    let clean = stripStoryImages(taggedText);
    clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replace(/<(?:UBS_image|image)>[\s\S]*?<\/(?:UBS_image|image)>/gi, '');
    clean = clean.replace(/```(?:json|statusbar|yaml)?\s*[\s\S]*?```/gi, '').trim();

    return clean || '（当前暂无最新剧情正文）';
  }

  /**
   * 将正文插图智能回写到酒馆当前聊天楼层
   */
  async function writeBackToTavernChat(mesId, updatedText) {
    const ctx = getTavernContext();
    const doc = window.parent?.document || document;

    // 方式 1: 官方 API setChatMessages
    if (typeof ctx?.setChatMessages === 'function' && mesId !== undefined) {
      try {
        await ctx.setChatMessages([{ message_id: mesId, message: updatedText }]);
        if (typeof ctx.saveChatConditional === 'function') await ctx.saveChatConditional();
      } catch (e) { }
    }

    // 方式 2: 直接操作 ctx.chat / parent.chat 数组
    const chat = ctx?.chat || window.SillyTavern?.chat || window.parent?.SillyTavern?.chat;
    let targetIdx = mesId;
    if (Array.isArray(chat) && chat.length > 0) {
      if (targetIdx === undefined || !chat[targetIdx]) {
        targetIdx = chat.length - 1;
      }
      if (chat[targetIdx]) {
        chat[targetIdx].mes = updatedText;
        try {
          if (typeof ctx?.saveChatConditional === 'function') await ctx.saveChatConditional();
        } catch (e) { }
        try {
          const evtType = ctx?.eventTypes?.MESSAGE_UPDATED || 'message_updated';
          ctx?.eventSource?.emit?.(evtType, targetIdx);
        } catch (e) { }
      }
    }

    // 方式 3: 即时局部刷新 DOM，让插图立即可见
    if (targetIdx !== undefined && doc) {
      const mesTextEl = doc.querySelector(`#chat > .mes[mesid="${targetIdx}"] .mes_text`);
      if (mesTextEl) {
        if (typeof ctx?.messageFormatting === 'function') {
          try { mesTextEl.innerHTML = ctx.messageFormatting(updatedText, targetIdx, false, false); } catch (e) { }
        } else {
          // 直接替换插图 Markdown 标签为可预览 img 标签
          mesTextEl.innerHTML = updatedText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<div class="story-img-wrap" style="margin:10px 0;text-align:center;"><img src="$2" alt="$1" style="max-width:100%;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.18);display:inline-block;" /></div>');
        }
      }
    }

    return true;
  }

  /**
   * 2. 调用统一生图 API (兼容 OpenAI / Stable Diffusion / NovelAI / ComfyUI)
   */
  /**
   * 1. 自动探测并拉取端点支持的模型列表 (支持多层路由自适应与主流生图模型智能回退)
   */
  async function fetchModelList(endpoint, apiKey) {
    let raw = (endpoint || '').trim().replace(/\/+$/, '');
    if (!raw) throw new Error('API 端点 (URL) 为空，请先填写端点地址');

    // 清洗掉末尾的接口动作路径
    raw = raw.replace(/\/(?:images\/generations|chat\/completions|completions|models)$/i, '');

    // 候选探测路由 (按优先级探测)
    const candidateUrls = [];
    if (raw.endsWith('/v1')) {
      candidateUrls.push(`${raw}/models`);
      candidateUrls.push(`${raw.slice(0, -3)}/models`);
    } else {
      candidateUrls.push(`${raw}/v1/models`);
      candidateUrls.push(`${raw}/models`);
    }

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey && apiKey.trim()) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }

    let modelList = [];
    let lastError = null;

    for (const testUrl of candidateUrls) {
      try {
        const resp = await fetch(testUrl, {
          method: 'GET',
          headers
        });
        if (resp.ok) {
          const data = await resp.json().catch(() => null);
          if (data) {
            let items = [];
            if (Array.isArray(data.data)) items = data.data;
            else if (Array.isArray(data)) items = data;
            else if (Array.isArray(data.models)) items = data.models;

            const extracted = items.map(m => (typeof m === 'string' ? m : (m.id || m.name))).filter(Boolean);
            if (extracted.length > 0) {
              modelList = extracted;
              break;
            }
          }
        }
      } catch (e) {
        lastError = e;
      }
    }

    // 若服务端成功返回列表
    if (modelList.length > 0) {
      // 智能把生图相关模型排在最前面
      modelList.sort((a, b) => {
        const isImgA = /dall|flux|image|midjourney|sd|draw|diffusion/i.test(a);
        const isImgB = /dall|flux|image|midjourney|sd|draw|diffusion/i.test(b);
        if (isImgA && !isImgB) return -1;
        if (!isImgA && isImgB) return 1;
        return a.localeCompare(b);
      });
      return modelList;
    }

    const reason = lastError ? (lastError.message || String(lastError)) : '未返回有效模型列表';
    throw new Error(`无法从生图端点获取模型列表: ${reason}。请检查端点地址与密钥。`);
  }

  async function generateImage(prompt, options = {}) {
    const s = store()?.getSettings() || {};
    const provider = options.provider || s.drawApiProvider || 'openai'; // 'openai' | 'novelai' | 'comfyui'

    // 严守铁律与物理隔离：生图参数仅从用户在【统一生图 API】中专门配置的字段读取，绝不消费文本 Chat 预设，绝不回退到文本 API
    let endpoint = (options.endpoint || s.drawApiEndpoint || '').trim();
    let apiKey = (options.apiKey || s.drawApiKey || '').trim();
    let model = (options.model || s.drawModel || '').trim();

    // 智能拼接用户设置的全局正向词前缀
    let finalPrompt = (prompt || '').trim();
    const prefix = (s.drawPromptPrefix || '').trim();
    if (prefix && !options.skipPrefix && !finalPrompt.startsWith(prefix)) {
      finalPrompt = `${prefix}, ${finalPrompt}`;
    }
    const negativePrompt = (options.negative || s.drawNegativePrompt || '').trim();

    // 解析尺寸
    const sizeStr = options.size || '1024x1024';
    const [wStr, hStr] = sizeStr.split('x');
    const width = parseInt(wStr, 10) || 1024;
    const height = parseInt(hStr, 10) || 1024;

    console.log(`[状态栏绘图] 发起文生图请求 | 供应商: ${provider} | 尺寸: ${width}x${height} | 模型: ${model || '(默认)'}`);

    // ==========================================
    // 1. OpenAI 兼容供应商 (DALL-E 3 / FLUX / SD3 / 中转接口)
    // ==========================================
    if (provider === 'openai') {
      if (!endpoint) {
        throw new Error('【通用状态栏】生图 API 地址未配置！请前往 设置 → 统一生图 API 中填写 Base URL。');
      }
      if (!model) {
        throw new Error('【通用状态栏】未配置生图模型名称！请前往 设置 → 统一生图 API 中填写模型名。');
      }

      let base = normalizeBaseUrl(endpoint);
      if (!base.endsWith('/v1') && !base.includes('/v1/')) {
        base += '/v1';
      }

      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const bodyPayload = {
        model,
        prompt: finalPrompt,
        n: 1,
        size: sizeStr,
        response_format: 'b64_json'
      };

      let resp = await fetch(`${base}/images/generations`, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload)
      });


      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`OpenAI 兼容绘图请求失败 (HTTP ${resp.status}): ${errText.slice(0, 300)}`);
      }

      const resJson = await resp.json();
      const item = resJson?.data?.[0];
      if (!item) throw new Error('API 返回的数据中不包含图像内容');

      if (item.b64_json) {
        return { dataUrl: `data:image/png;base64,${item.b64_json}`, prompt: finalPrompt };
      }
      if (item.url) {
        return { url: item.url, prompt: finalPrompt };
      }
      throw new Error('未解析到有效的图片 base64 或 url');
    }

    // ==========================================
    // 2. NovelAI 供应商
    // ==========================================
    if (provider === 'novelai') {
      const naiBase = normalizeBaseUrl(endpoint || 'https://api.novelai.net');
      const naiUrl = naiBase.endsWith('/ai/generate-image') ? naiBase : `${naiBase}/ai/generate-image`;
      const naiModel = model || 'nai-diffusion-3';

      if (!apiKey) {
        throw new Error('【通用状态栏】NovelAI API Key 未配置！请前往 设置 → 统一生图 API 中填写 pst-... 密钥。');
      }

      const naiPayload = {
        input: finalPrompt,
        model: naiModel,
        action: 'generate',
        parameters: {
          width,
          height,
          scale: 5,
          sampler: 'k_euler',
          steps: 28,
          n_samples: 1,
          ucPreset: 0,
          qualityToggle: true,
          uc: negativePrompt
        }
      };

      const resp = await fetch(naiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(naiPayload)
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`NovelAI 绘图请求失败 (HTTP ${resp.status}): ${errText.slice(0, 300)}`);
      }

      // 检查返回类型：可能是 zip 数据流，或部分三方反代返回的 json
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const j = await resp.json();
        const b64 = j?.data?.[0]?.b64_json || j?.image;
        if (b64) return { dataUrl: `data:image/png;base64,${b64}`, prompt: finalPrompt };
      }

      // 处理二进制流 (直接转为 base64)
      const buffer = await resp.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const b64Data = window.btoa(binary);

      // NovelAI 官方返回的是包含单个 png 的 zip 归档，若环境有 JSZip 优先解压
      if (typeof window.JSZip !== 'undefined') {
        try {
          const zip = await window.JSZip.loadAsync(buffer);
          const firstFileName = Object.keys(zip.files)[0];
          if (firstFileName) {
            const pngBase64 = await zip.files[firstFileName].async('base64');
            return { dataUrl: `data:image/png;base64,${pngBase64}`, prompt: finalPrompt };
          }
        } catch (e) {
          console.warn('[状态栏绘图] JSZip 解包 NovelAI 图片包失败，回退直接使用:', e);
        }
      }

      return { dataUrl: `data:image/png;base64,${b64Data}`, prompt: finalPrompt };
    }

    // ==========================================
    // 3. ComfyUI 供应商
    // ==========================================
    if (provider === 'comfyui') {
      const comfyBase = normalizeBaseUrl(endpoint || s.comfyUrl || 'http://127.0.0.1:8188');
      const workflowStr = (s.comfyWorkflow || '').trim();

      if (!workflowStr) {
        throw new Error('【通用状态栏】未配置 ComfyUI 工作流 JSON！请前往 设置 → 统一生图 API 中粘贴工作流，并确保包含 %prompt% 占位符。');
      }

      let workflowJson;
      try {
        const injected = workflowStr.replace(/%prompt%/g, finalPrompt.replace(/"/g, '\\"'));
        workflowJson = JSON.parse(injected);
      } catch (err) {
        throw new Error(`ComfyUI 工作流 JSON 解析失败: ${err.message}`);
      }

      const promptResp = await fetch(`${comfyBase}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflowJson })
      });

      if (!promptResp.ok) {
        const errText = await promptResp.text().catch(() => '');
        throw new Error(`ComfyUI 提交工作流失败 (HTTP ${promptResp.status}): ${errText.slice(0, 300)}`);
      }

      const promptResult = await promptResp.json();
      const promptId = promptResult?.prompt_id;
      if (!promptId) throw new Error('ComfyUI 未返回有效的 prompt_id');

      // 轮询历史记录获取图片输出 (最多等待 60 秒)
      const pollStart = Date.now();
      while (Date.now() - pollStart < 60000) {
        await new Promise(r => setTimeout(r, 2000));
        const historyResp = await fetch(`${comfyBase}/history/${promptId}`);
        if (historyResp.ok) {
          const histData = await historyResp.json();
          const item = histData[promptId];
          if (item && item.outputs) {
            for (const nodeId of Object.keys(item.outputs)) {
              const output = item.outputs[nodeId];
              if (Array.isArray(output.images) && output.images.length > 0) {
                const imgInfo = output.images[0];
                const viewUrl = `${comfyBase}/view?filename=${encodeURIComponent(imgInfo.filename)}&subfolder=${encodeURIComponent(imgInfo.subfolder || '')}&type=${encodeURIComponent(imgInfo.type || 'output')}`;
                return { url: viewUrl, prompt: finalPrompt };
              }
            }
          }
        }
      }

      throw new Error('ComfyUI 生图超时 (60s 未完成)');
    }

    throw new Error(`不支持的生图供应商: ${provider}`);
  }

  /**
   * 3. 上传或保存生成图片至酒馆服务端
   */
  async function uploadImage(dataUrlOrUrl, category = 'avatar', name = 'char') {
    if (!dataUrlOrUrl) throw new Error('图片数据为空');

    if (/^https?:\/\//i.test(dataUrlOrUrl)) {
      return { path: dataUrlOrUrl, isExternal: true };
    }

    try {
      const match = dataUrlOrUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,([\s\S]+)$/);
      if (match) {
        const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
        const safeName = (name || 'image').replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 30);
        const filename = `${category}_${safeName}_${Date.now()}.${ext}`;

        const resp = await fetch('/api/images/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: dataUrlOrUrl,
            filename,
            category
          })
        });

        if (resp.ok) {
          const res = await resp.json();
          if (res && res.path) {
            return { path: res.path, filename };
          }
        }
      }
    } catch (e) {
      console.warn('[状态栏绘图] 酒馆图片上传接口不可用，转为本地存储:', e);
    }

    return { path: dataUrlOrUrl, filename: `local_${Date.now()}.png` };
  }

  /**
   * 通用 LLM 文本请求接口 (优先通过 STATUSBAR_API 解析预设路由，兼容 TavernHelper，全量注入顶层 System 破限)
   */
  async function callLlm(rawMessages, options = {}, featureName = 'imagePrompt') {
    if (window.STATUSBAR_API && typeof window.STATUSBAR_API.callLLM === 'function') {
      return await window.STATUSBAR_API.callLLM(rawMessages, { featureName, ...options });
    }
    throw new Error('未检测到通用状态栏 API 管理器 (STATUSBAR_API.callLLM)');
  }



  /**
   * 调用 LLM 提炼与生成角色专属英文立绘 Prompt
   * 严格遵循 4 阶段提示词装配规范：设定你是谁 -> 角色卡蓝灯设定集+在场角色状态 -> 当前剧情正文 -> 规则契约结尾强调固定 1 张
   * 完美支持全员NPC与主角本人立绘生成（主角立绘明确强制清晰五官面容，覆盖正文插图无脸限制）
   */
  async function generatePortraitPromptWithLlm(charInfo, storyText = '') {
    let charName = String(charInfo.name || '').trim();

    // 检测是否为主角
    const snapPro = core()?.getProtagonistState?.();
    const proName = (snapPro?.name || '').trim();

    const isPro = Boolean(
      charInfo.isProtagonist ||
      charInfo.charType === '主角' ||
      (proName && charName === proName)
    );

    if (isPro) {
      charInfo = Object.assign({}, snapPro || {}, charInfo, { isProtagonist: true });
      if (!charName) charName = proName;
    }
    if (!charName) {
      throw new Error('未指定角色姓名，无法提炼立绘提示词');
    }

    // 1. 提取角色卡专属全部蓝灯世界书 (全文无截断)
    const blueLightWorldbook = await getCharacterCardBlueLightWorldbook();
    // 2. 提取信息表所有在场角色完整状态 (全量字段无截断)
    const characterStates = getAllPresentCharacterStates(charName);
    // 3. 提取当前剧情完整正文 (无截断)
    const cleanStory = await getCleanStoryText(storyText);

    // Message 1: system：提示词设定你是谁
    const sys1 = isPro
      ? `你是一名顶级动漫与写实角色肖像艺术总监与生图提示词专家（Master Prompt Engineer for NovelAI, Stable Diffusion, DALL-E 3 and FLUX）。\n你的任务是深入阅读并融合下方的角色卡蓝灯设定集、所有在场角色状态（重点参照主角信息表中主角的体貌特征、发型发色、眼神眼瞳、年龄体格、当下穿搭与气质）、以及当前剧情描写，为主角本人【${charName}】量身撰写高精度单人纯英文肖像立绘提示词。`
      : `你是一名顶级动漫与写实角色肖像艺术总监与生图提示词专家（Master Prompt Engineer for NovelAI, Stable Diffusion, DALL-E 3 and FLUX）。\n你的任务是深入阅读并融合下方的角色卡蓝灯设定集、所有在场角色状态、以及当前剧情描写，为指定角色【${charName}】量身撰写高精度纯英文肖像立绘提示词。`;

    // Message 2: user：设定集 + 角色状态
    const user1 = `<设定集>\n${blueLightWorldbook || '（无角色卡蓝灯设定）'}\n</设定集>\n\n<角色状态>\n${characterStates}\n</角色状态>`;

    // Message 3: user：当前剧情
    const user2 = `<当前剧情>\n${cleanStory}\n</当前剧情>`;

    // Message 4: system：提示词设定你是谁，怎么生成 结尾强调固定生成 1 张
    const gender = (charInfo.gender || '').trim();
    const isMale = gender.includes('男');
    const isFemale = gender.includes('女');
    const genderTag = isMale ? '1boy, handsome male' : isFemale ? '1girl, beautiful female' : '1person';

    let sys2;
    if (isPro) {
      sys2 = `你是一名专业角色肖像艺术总监。请根据上述<设定集>、<角色状态>与<当前剧情>，为主角本人【${charName}】生成最贴合此刻剧情、服装、五官容貌与气质神态的纯英文肖像立绘提示词。\n\n【主角专属立绘最高规则（覆盖一切正文出镜限制）】：\n1. 本轮生成目标为主角本人【${charName}】的正面/半身单人专属肖像立绘（Portrait / Avatar）！\n2. 必须清晰、细致刻画主角本人的五官面容、清澈眼神、发型发色、眉宇神采与气质风貌！\n3. 严禁执行任何“主角不入镜/无脸（faceless）/仅局部肢体/背影”的限制！绝不画成无脸或截断头部！必须正面或微侧面展现主角的真实面容！\n4. ${gender ? `主角性别为【${gender}】，必须准确输出【${genderTag}】及贴合其体态年龄的气质特征。` : `必须准确输出贴合主角体态年龄与气质神态的特征。`}\n\n生图提示词撰写规则：\n1. 必须 100% 英文输出，严格禁止输出任何中文字符或中文姓名！\n2. 结构构成：\n   - 主体：${genderTag}, [精准年龄与气质体态定位]\n   - 五官与发型：发色、发型、刘海、眼瞳颜色与眼神，严格基于主角人设与状态\n   - 服装与穿搭：完整准确转译当下主角穿戴的衣物（外套、上衣、裤装、配饰等细节）\n   - 姿态神情与场景环境：upper body portrait, looking towards viewer, 根据当下剧情展现其微表情与沉稳姿态，背景光影契合剧情所处场所\n3. 输出格式要求：直接输出以逗号分隔的纯英文 Prompt 文本，严禁包含 markdown 代码块、引号或解释说明文字。\n\n## 张数要求（最高优先级铁律）\n本轮固定生成 1 张针对主角【${charName}】的高清肖像立绘提示词！直接输出该张纯英文 Prompt 文本。`;
    } else {
      sys2 = `你是一名专业角色肖像艺术总监。请根据上述<设定集>、<角色状态>与<当前剧情>，为目标角色【${charName}】生成最贴合此刻剧情、服装与神态的纯英文肖像立绘提示词。\n\n生图提示词撰写规则：\n1. 必须 100% 英文输出，严格禁止输出任何中文字符或中文姓名！\n2. 结构构成：\n   - 主体：${genderTag}，精准年龄与气质外貌定位\n   - 五官与发型：发色、发型、刘海、眼瞳颜色与眼神、眼镜配饰等，严格基于设定与状态\n   - 服装与穿搭：完整准确转译当下穿着的各层衣物（外套、上装、下装、领口、袖长等细节）\n   - 姿态神情与场景环境：upper body portrait, looking towards viewer, 根据当下剧情状态展现其微表情与动作，背景环境契合剧情所处场所\n3. 输出格式要求：直接输出以逗号分隔的纯英文 Prompt 文本，严禁包含 markdown 代码块、引号或解释说明文字。\n\n## 张数要求（最高优先级铁律）\n本轮固定生成 1 张针对目标角色【${charName}】的高清肖像立绘提示词！直接输出该张纯英文 Prompt 文本。`;
    }

    const messages = [
      { role: 'system', content: sys1 },
      { role: 'user', content: user1 },
      { role: 'user', content: user2 },
      { role: 'system', content: sys2 }
    ];

    try {
      console.log(`[状态栏立绘] 正在调用 LLM 肖像总监为【${charName}】${isPro ? '(主角)' : ''}生成专属立绘提示词 (四阶段装配: 蓝灯设定集+在场状态+当前正文, 固定1张)...`);
      const rawPrompt = await callLlm(messages, { temperature: 0.6 });

      // 清洗返回结果：去除前缀、代码块与可能残留的非 ASCII 中文
      let cleaned = rawPrompt
        .replace(/^\`\`\`[a-z]*\s*/i, '')
        .replace(/\s*\`\`\`$/i, '')
        .replace(/^(Prompt|Prompt\s*:|Image Prompt\s*:)/i, '')
        .trim();

      cleaned = cleaned.replace(/[\u4e00-\u9fa5]/g, '').replace(/，/g, ',').replace(/\s*,\s*,+/g, ',').trim();
      if (!cleaned) throw new Error('LLM 返回的立绘提示词为空');
      console.log(`[状态栏立绘] LLM 生成【${charName}】立绘提示词成功:\n${cleaned}`);
      return cleaned;
    } catch (e) {
      console.error(`[状态栏立绘] LLM 生成【${charName}】立绘提示词失败:`, e.message || e);
      throw e;
    }
  }

  /**
   * 角色专属头像立绘生成函数 (固定生成 1 张，并立即同步保存至图库与活跃头像)
   * 100% 同步支持主角与全员角色
   */
  async function generateAvatar(charInfo, customPrompt = '', storyText = '') {
    if (!charInfo) throw new Error('未指定角色信息');
    let charName = String(charInfo.name || '').trim();

    // 检测是否为主角并补充主角全景信息
    const snapPro = core()?.getProtagonistState?.();
    const proName = (snapPro?.name || '').trim();

    const isPro = Boolean(
      charInfo.isProtagonist ||
      charInfo.charType === '主角' ||
      (proName && charName === proName)
    );

    if (isPro) {
      charInfo = Object.assign({}, snapPro || {}, charInfo, { isProtagonist: true });
      if (!charName) charName = proName;
    }
    if (!charName) {
      throw new Error('未指定角色姓名，无法生成专属立绘');
    }

    let prompt = customPrompt.trim();
    if (!prompt) {
      // 核心：调用 LLM 深度分析人设蓝灯、在场角色状态与当下正文，固定生成 1 张专业纯英文生图提示词！
      prompt = await generatePortraitPromptWithLlm(charInfo, storyText);
    }

    console.log(`[状态栏立绘] 发起生图请求（固定 1 张，目标: ${charName}${isPro ? ' (主角)' : ''}），提示词:\n${prompt}`);
    const genResult = await generateImage(prompt, { size: '1024x1024' });
    const imgData = genResult.dataUrl || genResult.url;

    const saved = await uploadImage(imgData, 'avatar', charName);
    const avatarItem = {
      id: 'ava_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      path: saved.path,
      promptText: prompt,
      description: `${charName} 的角色立绘`,
      createdAt: Date.now()
    };

    const s = store()?.getSettings() || {};
    const galleries = s.avatarGalleries || {};
    if (!galleries[charName]) galleries[charName] = [];
    galleries[charName].unshift(avatarItem);
    const avatars = s.charAvatars || {};
    avatars[charName] = saved.path;

    // 若是主角，同步到 proName 和 '主角' 双键下，确保任意入口皆可展示
    if (isPro) {
      if (proName && proName !== charName) {
        avatars[proName] = saved.path;
        if (!galleries[proName]) galleries[proName] = [];
        galleries[proName].unshift(avatarItem);
      }
      if (charName !== '主角') {
        avatars['主角'] = saved.path;
        if (!galleries['主角']) galleries['主角'] = [];
        galleries['主角'].unshift(avatarItem);
      }
    }

    store()?.updateSettings({ avatarGalleries: galleries, charAvatars: avatars });

    return {
      ok: true,
      path: saved.path,
      prompt
    };
  }

  // 记录自动更新立绘状态与防频繁重试集合
  let isAutoPortraiting = false;
  const failedPortraitCharsThisSession = new Set();

  /**
   * 自动检查并更新在场角色专属立绘/头像
   * 支持模式：
   * - 'missing-only': 仅无立绘角色自动更新 (默认推荐)
   * - 'every-turn': 每轮在场角色自动更新
   * - 'off': 不自动更新
   */
  async function triggerAutoPortraitUpdate(storyText = '') {
    const s = store()?.getSettings() || {};
    if (!s.portraitEnabled || s.portraitAutoUpdateMode === 'off') {
      return { ok: false, reason: '立绘功能未开启或设置为不自动更新' };
    }

    if (isAutoPortraiting) {
      console.log('[通用状态栏立绘] 当前已有正在执行的自动立绘更新，跳过重复触发');
      return { ok: false, reason: '已有任务在执行中' };
    }

    // 辅助函数：严格判定角色是否在场 (严禁不在场角色画立绘)
    const checkIsPresent = (c) => {
      if (!c) return false;
      if (typeof c.isPresent === 'boolean') return c.isPresent;
      return String(c['是否在场'] ?? '').trim() === '1';
    };

    // 1. 搜集候选在场角色列表 (核心铁律：以插件主页面板「在场角色:」列表为唯一样本源)
    const snapshot = core()?.getFullSnapshot?.() || {};
    const presentChars = core()?.getPresentCharactersState?.() || snapshot.characters || [];

    const candidateMap = new Map();
    for (const c of presentChars) {
      if (checkIsPresent(c)) {
        const name = String(c.name || '').trim();
        if (name && !candidateMap.has(name)) candidateMap.set(name, c);
      }
    }

    // 2. 主角信息识别（铁律：主角仅手动生成，绝对不参与自动绘图，用于严格排除）
    const snapPro = core()?.getProtagonistState?.() || snapshot.protagonist;
    const dbPro = db()?.getAllRows('主角信息表')?.[0];
    const proName = String(snapPro?.name || dbPro?.['姓名'] || '').trim();

    const isProtagonist = (c, name) => {
      if (!c) return false;
      if (c.charType === '主角' || c['角色类型'] === '主角') return true;
      if (proName && name === proName) return true;
      return false;
    };

    if (candidateMap.size === 0) {
      return { ok: true, count: 0 };
    }

    const mode = s.portraitAutoUpdateMode || 'missing-only';
    const charAvatars = s.charAvatars || {};
    const galleries = s.avatarGalleries || {};

    const hasAvatar = (name) => {
      if (!name) return false;
      if (charAvatars[name] && typeof charAvatars[name] === 'string' && charAvatars[name].trim() !== '') return true;
      if (Array.isArray(galleries[name]) && galleries[name].length > 0) return true;
      return false;
    };

    // 3. 过滤出待生成的角色队列
    const targets = [];
    for (const [name, charObj] of candidateMap.entries()) {
      // 核心铁律1：严格仅针对在场角色，严防不在场NPC画立绘
      if (!checkIsPresent(charObj)) {
        console.log(`[通用状态栏立绘] 角色「${name}」非在场角色，跳过自动立绘生成`);
        continue;
      }
      // 核心铁律2：自动绘图严格仅针对在场角色，绝对排除主角（主角仅手动生成）
      if (isProtagonist(charObj, name)) {
        continue;
      }
      if (failedPortraitCharsThisSession.has(name)) {
        continue;
      }
      if (mode === 'missing-only') {
        if (!hasAvatar(name)) {
          targets.push(charObj);
        }
      } else if (mode === 'every-turn') {
        targets.push(charObj);
      }
    }

    if (targets.length === 0) {
      return { ok: true, count: 0 };
    }

    isAutoPortraiting = true;
    console.log(`[通用状态栏立绘] 正在启动自动立绘生成 (模式: ${mode}, 待生成: ${targets.length} 人):`, targets.map(t => t.name));

    try {
      if (!storyText || !storyText.trim()) {
        storyText = await getLatestAiStoryText();
      }

      for (const targetChar of targets) {
        const charName = String(targetChar.name || '').trim();
        try {
          if (window.toastr) {
            window.toastr.info(`正在为「${charName}」${mode === 'every-turn' ? '更新' : '自动生成'}专属立绘…`, '角色专属立绘');
          }
          const res = await generateAvatar(targetChar, '', storyText);
          if (res && res.ok) {
            failedPortraitCharsThisSession.delete(charName);
            if (window.toastr) {
              window.toastr.success(`已为「${charName}」成功生成专属立绘！`, '角色专属立绘');
            }
            window.STATUSBAR_UI?.render?.();
          } else {
            failedPortraitCharsThisSession.add(charName);
          }
        } catch (charErr) {
          console.warn(`[通用状态栏立绘] 为「${charName}」生成立绘失败，本次会话暂缓重试:`, charErr.message || charErr);
          failedPortraitCharsThisSession.add(charName);
          if (window.toastr) {
            window.toastr.warning(`「${charName}」立绘生成失败：${charErr.message || '未知错误'}`, '角色专属立绘');
          }
        }
        // 角色之间微延迟，释放主线程与网络
        await new Promise(r => setTimeout(r, 400));
      }
    } finally {
      isAutoPortraiting = false;
    }

    return { ok: true, count: targets.length };
  }

  /**
   * 手动与楼层正文插图管理系统 (ub-story-regen-button 楼层按钮与手动插图流)
   */
  const STORY_REGEN_BTN_CLASS = 'ub-story-regen-button';
  const STORY_REGEN_BTN_BOTTOM_CLASS = 'ub-story-regen-button-bottom';
  const activeStoryImageMesIds = new Set();
  let storyObserverInstalled = false;

  /**
   * 统一设置楼层正文插图按钮的加载/转圈与不可点击状态
   */
  function setStoryRegenLoading(mesId, isLoading) {
    if (mesId == null || !Number.isInteger(Number(mesId))) return;
    const numId = Number(mesId);
    if (isLoading) {
      activeStoryImageMesIds.add(numId);
    } else {
      activeStoryImageMesIds.delete(numId);
    }

    const doc = window.parent?.document || document;
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    const btns = doc.querySelectorAll(`#chat > .mes[mesid="${numId}"] .${STORY_REGEN_BTN_CLASS}`);
    btns.forEach(btn => {
      if (isLoading) {
        btn.classList.remove('fa-images');
        btn.classList.add('fa-spinner', 'fa-spin');
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.85';
        btn.style.cursor = 'not-allowed';
        btn.title = `第 ${numId} 楼插图正在生成中，请稍候...`;
      } else {
        btn.classList.remove('fa-spinner', 'fa-spin');
        btn.classList.add('fa-images');
        btn.style.pointerEvents = '';
        btn.style.opacity = '';
        btn.style.cursor = 'pointer';
        btn.title = '重新生成插图';
      }
    });
  }

  /**
   * 手动触发指定楼层的正文插图生成
   */
  async function handleManualStoryImageGeneration(mesId) {
    const s = store()?.getSettings() || {};
    if (s.storyImageEnabled === false) {
      if (window.toastr) window.toastr.warning('正文插图功能总开关未开启，请在设置中开启', '正文插图');
      return { ok: false, error: '正文插图未开启' };
    }

    let targetMes = '';
    const ctx = getTavernContext();
    if (ctx && Array.isArray(ctx.chat) && ctx.chat[mesId]) {
      targetMes = ctx.chat[mesId].mes || '';
    }

    if (!targetMes) {
      const doc = window.parent?.document || document;
      const mesEl = doc.querySelector(`#chat > .mes[mesid="${mesId}"] .mes_text`);
      if (mesEl) {
        targetMes = mesEl.textContent || '';
      }
    }

    if (!targetMes || !targetMes.trim()) {
      if (window.toastr) window.toastr.warning(`第 ${mesId} 楼没有可插图的 AI 正文`, '正文插图');
      return { ok: false, error: '正文内容为空' };
    }

    if (window.toastr) window.toastr.info(`正在为第 ${mesId} 楼挑选插图位置并生成提示词…`, '正文插图');

    const cleanText = stripStoryImages(targetMes);
    try {
      const result = await generateStoryImages(cleanText, [], { mesId, manual: true, autoWriteBack: true });
      if (result && result.insertedResults && result.insertedResults.length > 0) {
        if (window.toastr) window.toastr.success(`第 ${mesId} 楼已成功生成并插入 ${result.insertedResults.length} 张插图！`, '正文插图');
      } else if (result && result.error) {
        if (window.toastr) window.toastr.error(result.error, '正文插图');
      }
      return result;
    } catch (err) {
      console.error('[状态栏绘图] 手动生成正文插图异常:', err);
      if (window.toastr) window.toastr.error('正文插图异常: ' + (err.message || err), '正文插图');
      return { ok: false, error: err.message || err };
    }
  }

  /**
   * 手动触发最新 AI 楼层的插图生成（供状态栏头部“插图”按钮调用）
   */
  async function triggerLatestStoryImageGeneration() {
    const doc = window.parent?.document || document;
    const ctx = getTavernContext();
    let latestAiId = null;

    // 1. 优先从 chat 数组倒序查找最新一条 AI 消息
    const chat = ctx?.chat || window.SillyTavern?.chat || window.parent?.SillyTavern?.chat;
    if (Array.isArray(chat)) {
      for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (m && !m.is_user && !m.is_system && m.mes) {
          latestAiId = i;
          break;
        }
      }
    }

    // 2. 回退：从 DOM #chat 倒序查找
    if (latestAiId === null && doc) {
      const mesEls = Array.from(doc.querySelectorAll('#chat > .mes[mesid]')).reverse();
      for (const el of mesEls) {
        if (el.getAttribute('is_user') !== 'true' && el.getAttribute('is_system') !== 'true') {
          latestAiId = Number(el.getAttribute('mesid'));
          break;
        }
      }
    }

    if (latestAiId === null || !Number.isInteger(latestAiId)) {
      if (window.toastr) window.toastr.warning('未找到可插图的 AI 消息楼层', '正文插图');
      return { ok: false, error: '未找到 AI 消息' };
    }

    return await handleManualStoryImageGeneration(latestAiId);
  }

  /**
   * 向酒馆每条 AI 消息楼层注入“重新生成插图”按钮
   */
  function injectStoryRegenButtons() {
    const doc = window.parent?.document || document;
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    const s = store()?.getSettings() || {};
    const enabled = s.storyImageEnabled !== false;

    const mesElements = doc.querySelectorAll('#chat > .mes[mesid]');
    mesElements.forEach(mesEl => {
      const existing = mesEl.querySelectorAll(`.${STORY_REGEN_BTN_CLASS}`);
      const mesIdStr = mesEl.getAttribute('mesid');
      const mesId = Number(mesIdStr);
      const isUser = mesEl.getAttribute('is_user') === 'true';
      const isSystem = mesEl.getAttribute('is_system') === 'true';

      if (!enabled || !Number.isInteger(mesId) || isUser || isSystem) {
        existing.forEach(e => e.remove());
        return;
      }

      if (existing.length >= 2) return; // 已注入完成
      existing.forEach(e => e.remove());

      const isDrawing = activeStoryImageMesIds.has(mesId);

      // 1. 顶部操作栏按钮（注入到 .mes_buttons 中，紧邻 .mes_edit）
      const buttonsContainer = mesEl.querySelector('.mes_buttons');
      if (buttonsContainer) {
        const topBtn = doc.createElement('div');
        topBtn.className = `mes_button ${STORY_REGEN_BTN_CLASS} fa-solid ${isDrawing ? 'fa-spinner fa-spin' : 'fa-images'} interactable`;
        topBtn.dataset.messageId = String(mesId);
        topBtn.dataset.location = 'top';
        topBtn.title = isDrawing ? `第 ${mesId} 楼插图正在生成中，请稍候...` : '重新生成插图';
        topBtn.setAttribute('role', 'button');
        topBtn.setAttribute('aria-label', `重新生成第 ${mesId} 楼的正文插图`);
        topBtn.style.cursor = isDrawing ? 'not-allowed' : 'pointer';
        if (isDrawing) {
          topBtn.style.pointerEvents = 'none';
          topBtn.style.opacity = '0.85';
        }

        const editBtn = buttonsContainer.querySelector('.mes_edit');
        if (editBtn) buttonsContainer.insertBefore(topBtn, editBtn);
        else buttonsContainer.appendChild(topBtn);
      }

      // 2. 底部浮动按钮
      const bottomBtn = doc.createElement('div');
      bottomBtn.className = `${STORY_REGEN_BTN_CLASS} ${STORY_REGEN_BTN_BOTTOM_CLASS} fa-solid ${isDrawing ? 'fa-spinner fa-spin' : 'fa-images'} interactable`;
      bottomBtn.dataset.messageId = String(mesId);
      bottomBtn.dataset.location = 'bottom';
      bottomBtn.title = isDrawing ? `第 ${mesId} 楼插图正在生成中，请稍候...` : '重新生成插图';
      bottomBtn.setAttribute('role', 'button');
      bottomBtn.setAttribute('aria-label', `重新生成第 ${mesId} 楼的正文插图`);
      bottomBtn.style.position = 'absolute';
      bottomBtn.style.bottom = '6px';
      bottomBtn.style.right = mesEl.querySelector('.ai-polisher-floor-button-bottom') ? '96px' : '72px';
      bottomBtn.style.zIndex = '10';
      bottomBtn.style.display = 'inline-flex';
      bottomBtn.style.alignItems = 'center';
      bottomBtn.style.justifyContent = 'center';
      bottomBtn.style.opacity = isDrawing ? '0.85' : '.55';
      bottomBtn.style.cursor = isDrawing ? 'not-allowed' : 'pointer';
      if (isDrawing) {
        bottomBtn.style.pointerEvents = 'none';
      }
      bottomBtn.style.fontSize = '14px';
      bottomBtn.style.transition = 'opacity .18s ease, transform .18s ease';

      bottomBtn.addEventListener('mouseenter', () => {
        if (!activeStoryImageMesIds.has(mesId)) {
          bottomBtn.style.opacity = '1';
          bottomBtn.style.transform = 'scale(1.12)';
        }
      });
      bottomBtn.addEventListener('mouseleave', () => {
        if (!activeStoryImageMesIds.has(mesId)) {
          bottomBtn.style.opacity = '.55';
          bottomBtn.style.transform = 'none';
        }
      });

      const swipeRight = mesEl.querySelector('.swipeRightBlock');
      if (swipeRight && swipeRight.parentNode) {
        swipeRight.parentNode.insertBefore(bottomBtn, swipeRight);
      } else {
        (mesEl.querySelector('.mes_block') || mesEl).appendChild(bottomBtn);
      }
    });
  }

  /**
   * 初始化楼层插图按钮的事件委托监听与 DOM 变动监听器
   */
  function initStoryFloorButtons() {
    const doc = window.parent?.document || document;
    if (!doc || typeof doc.querySelectorAll !== 'function' || typeof doc.getElementById !== 'function' || typeof doc.addEventListener !== 'function') return;

    injectStoryRegenButtons();

    if (!storyObserverInstalled) {
      storyObserverInstalled = true;
      doc.addEventListener('click', async (e) => {
        const btn = e.target?.closest?.(`.${STORY_REGEN_BTN_CLASS}`);
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const mesId = Number(btn.dataset.messageId);
        if (Number.isInteger(mesId)) {
          if (activeStoryImageMesIds.has(mesId)) {
            console.log(`[状态栏绘图] 第 ${mesId} 楼插图正在生成中，拦截重复点击`);
            return;
          }
          console.log(`[状态栏绘图] 用户点击楼层按钮手动触发第 ${mesId} 楼插图生成`);
          setStoryRegenLoading(mesId, true);
          try {
            await handleManualStoryImageGeneration(mesId);
          } finally {
            setStoryRegenLoading(mesId, false);
          }
        }
      }, true);

      const chatEl = doc.getElementById('chat');
      if (chatEl) {
        const observer = new MutationObserver((mutations) => {
          if (mutations.some(m => m.addedNodes.length > 0)) {
            requestAnimationFrame(() => injectStoryRegenButtons());
          }
        });
        observer.observe(chatEl, { childList: true, subtree: true });
      }
    }
  }

  // 立即尝试绑定楼层按钮
  try {
    if (typeof window !== 'undefined') {
      initStoryFloorButtons();
    }
  } catch (e) { }

  // --- 精确文本与段落定位算法 ---
  function normalizeQuote(str) {
    return String(str || '')
      .replace(/\s+/g, '')
      .replace(/[，。！？；：、""''「」『』（）【】《》…—·ˉ·,.!?;:'"()[\]{}<>~*\-_|/\\#$%^&+=@`]/g, '');
  }

  function splitParagraphs(text) {
    const lines = String(text || '').split(/\n/);
    const paragraphs = [];
    let buf = [];
    const flush = () => {
      const p = buf.join('\n').trim();
      if (p) paragraphs.push(p);
      buf = [];
    };
    for (const l of lines) {
      if ('' === l.trim()) flush();
      else buf.push(l);
    }
    flush();
    return paragraphs;
  }

  function bigramFreq(str) {
    const map = new Map();
    if (str.length < 2) {
      if (str) map.set(str, 1);
      return map;
    }
    for (let i = 0; i < str.length - 1; i++) {
      const bg = str.slice(i, i + 2);
      map.set(bg, (map.get(bg) || 0) + 1);
    }
    return map;
  }

  function bigramSimilarity(s1, s2) {
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;
    const m1 = bigramFreq(s1);
    const m2 = bigramFreq(s2);
    let total1 = 0, total2 = 0, common = 0;
    for (const [, v] of m1) total1 += v;
    for (const [, v] of m2) total2 += v;
    for (const [bg, v1] of m1) {
      const v2 = m2.get(bg) || 0;
      common += Math.min(v1, v2);
    }
    const denom = total1 + total2;
    return denom ? (2 * common) / denom : 0;
  }

  function fuzzyFind(needle, haystack) {
    if (!needle || !haystack) return 0;
    if (haystack.length <= 2 * needle.length) return bigramSimilarity(needle, haystack);
    const step = Math.max(4, needle.length);
    const half = Math.max(2, Math.floor(step / 2));
    let best = 0;
    for (let i = 0; i + Math.min(step, 8) <= haystack.length; i += half) {
      const sim = bigramSimilarity(needle, haystack.slice(i, i + step));
      if (sim > best) best = sim;
      if (best === 1) break;
    }
    return best;
  }

  function locateTargetLineIndex(text, positionQuote) {
    if (!text || !positionQuote) return -1;
    const lines = String(text || '').split(/\n/);
    const qNorm = normalizeQuote(positionQuote);
    if (!qNorm) return -1;

    // 1. 优先：单行精准子串包含
    for (let i = 0; i < lines.length; i++) {
      const lNorm = normalizeQuote(lines[i]);
      if (lNorm && lNorm.includes(qNorm)) return i;
    }

    // 2. 次优：原句前段 (8~12字) 命中
    const qStart = qNorm.slice(0, Math.min(10, qNorm.length));
    if (qStart.length >= 4) {
      for (let i = 0; i < lines.length; i++) {
        const lNorm = normalizeQuote(lines[i]);
        if (lNorm && lNorm.includes(qStart)) return i;
      }
    }

    // 3. 原句后段 (8~12字) 命中
    const qEnd = qNorm.slice(-Math.min(10, qNorm.length));
    if (qEnd.length >= 4) {
      for (let i = 0; i < lines.length; i++) {
        const lNorm = normalizeQuote(lines[i]);
        if (lNorm && lNorm.includes(qEnd)) return i;
      }
    }

    // 4. 跨行全文精确搜索：计算该句子在全文中结束在哪一行
    const fullNorm = normalizeQuote(text);
    const matchPos = fullNorm.indexOf(qNorm);
    if (matchPos !== -1) {
      let charCount = 0;
      for (let i = 0; i < lines.length; i++) {
        charCount += normalizeQuote(lines[i]).length;
        if (charCount >= matchPos + qNorm.length) return i;
      }
    }

    // 5. 双字滑动窗口最大相似度兜底
    let bestLine = -1;
    let bestScore = 0;
    for (let i = 0; i < lines.length; i++) {
      const lNorm = normalizeQuote(lines[i]);
      if (!lNorm) continue;
      const sim = bigramSimilarity(qNorm, lNorm);
      if (sim > bestScore) {
        bestScore = sim;
        bestLine = i;
      }
    }
    if (bestScore >= 0.35 && bestLine >= 0) return bestLine;

    return -1;
  }

  function adjustLineOutsideRestrictedTags(lines, targetLineIdx) {
    if (targetLineIdx < 0 || targetLineIdx >= lines.length) return targetLineIdx;

    let currentTag = null;
    let startLine = -1;
    const ranges = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!currentTag) {
        const openMatch = line.match(/<(thinking|think|close-up)(?:\s+[^>]*)?>/i);
        if (openMatch) {
          const tag = openMatch[1].toLowerCase();
          const closeMatch = line.match(new RegExp(`</${tag}>`, 'i'));
          if (closeMatch && closeMatch.index > openMatch.index) {
            continue;
          }
          currentTag = tag;
          startLine = i;
        }
      } else {
        const closeMatch = line.match(new RegExp(`</${currentTag}>`, 'i'));
        if (closeMatch) {
          ranges.push({ tag: currentTag, startLine, endLine: i });
          currentTag = null;
          startLine = -1;
        }
      }
    }

    if (currentTag && startLine !== -1) {
      ranges.push({ tag: currentTag, startLine, endLine: lines.length - 1 });
    }

    for (const r of ranges) {
      if (targetLineIdx >= r.startLine && targetLineIdx < r.endLine) {
        return r.endLine;
      }
    }

    return targetLineIdx;
  }

  function insertImagesIntoStoryText(originalText, insertions) {
    if (!insertions || !insertions.length) return originalText;
    const lines = String(originalText || '').split(/\n/);

    const unmapped = [];
    const targetMap = new Map();
    for (const item of insertions) {
      if (!item.markdown) continue;
      let targetLineIdx = item.lineIndex != null && item.lineIndex >= 0 ? item.lineIndex : -1;
      if (targetLineIdx < 0 && item.positionQuote) {
        targetLineIdx = locateTargetLineIndex(originalText, item.positionQuote);
      }
      if (targetLineIdx >= 0 && targetLineIdx < lines.length) {
        targetLineIdx = adjustLineOutsideRestrictedTags(lines, targetLineIdx);
      }
      if (targetLineIdx < 0 || targetLineIdx >= lines.length) {
        unmapped.push(item.markdown);
        continue;
      }
      const list = targetMap.get(targetLineIdx) || [];
      list.push(item.markdown);
      targetMap.set(targetLineIdx, list);
    }

    if (!targetMap.size && !unmapped.length) return originalText;

    const res = [];
    for (let i = 0; i < lines.length; i++) {
      res.push(lines[i]);
      const hits = targetMap.get(i);
      if (hits && hits.length) {
        for (const md of hits) {
          res.push('');
          res.push(md);
        }
      }
    }

    if (unmapped.length) {
      while (res.length && '' === res[res.length - 1].trim()) res.pop();
      for (const md of unmapped) {
        res.push('');
        res.push(md);
      }
    }

    return res.join('\n');
  }

  async function generateStoryImages(storyText, characters = [], options = {}) {
    if (!storyText || typeof storyText !== 'string') return { ok: false, error: '正文为空' };
    const s = store()?.getSettings() || {};
    // 只要开启了自动插图，或者手动触发，均视为总功能开启
    if (s.storyImageEnabled === false && !s.autoDrawEnabled && !options.manual) {
      return { ok: false, error: '正文插图功能总开关已关闭' };
    }
    if (!s.autoDrawEnabled && !options.manual) {
      return { ok: false, error: '自动正文绘图未开启' };
    }

    // 核心铁律：首层 (0 楼开局问候语) 绝对禁止自动正文插图！
    // 用户明确要求：插图应该只插新回复，严禁在首层绘图
    if (!options.manual && options.mesId !== undefined && Number(options.mesId) <= 0) {
      console.log(`[状态栏绘图] 目标楼层为 ${options.mesId} (首层开局问候语)，坚决拦截自动插图，仅在新回复时生成`);
      return { ok: false, skipped: true, error: '首层开局问候语不自动生成插图' };
    }

    // 正文字数门槛：以用户配置的 storyImageMinReplyChars 为准，默认 150 字
    const minChars = parseInt(s.storyImageMinReplyChars, 10) || 150;
    const cleanText = storyText.replace(/<[^>]+>/g, '').trim();
    if (!options.manual && cleanText.length < minChars) {
      console.log(`[状态栏绘图] 正文字数 (${cleanText.length}) 低于配置门槛 (${minChars} 字)，跳过本次自动调用`);
      return { ok: false, skipped: true, error: `正文字数低于门槛 (${cleanText.length} < ${minChars})` };
    }

    // 用户自定义随机张数区间 roll 机制 (多张：具体多少张看用户配置 min~max，或 options.count)
    const minImgs = Math.max(1, parseInt(s.autoDrawMinImages, 10) || 4);
    const maxImgs = Math.max(minImgs, parseInt(s.autoDrawMaxImages, 10) || 8);
    const rollCount = options.count ? options.count : (Math.floor(Math.random() * (maxImgs - minImgs + 1)) + minImgs);
    console.log(`[状态栏绘图] 开始正文插图生成：配置区间 ${minImgs}~${maxImgs} 张，本轮目标张数: ${rollCount} 张`);

    const targetMesId = (options.mesId !== undefined && Number.isInteger(Number(options.mesId))) ? Number(options.mesId) : null;
    if (targetMesId !== null) {
      setStoryRegenLoading(targetMesId, true);
    }

    try {
      // 1. 提取角色卡蓝灯世界书 (全量无截断)
      const blueLightWorldbook = await getCharacterCardBlueLightWorldbook();
    // 2. 提取信息表所有在场角色状态 (全量无截断)
    const characterStates = getAllPresentCharacterStates();
    // 3. 提取当前剧情完整正文 (全量无截断)
    const cleanStory = await getCleanStoryText(storyText, options);

    // Message 1: system：提示词设定你是谁
    const sys1 = `你是一名专业插画导演兼摄影指导。你的任务是深入阅读下方的设定集、所有在场角色状态与当前剧情描写，挑选最具画面感的精彩瞬间，为生图模型撰写高精度结构化纯英文生图提示词。`;

    // Message 2: user：设定集 + 角色状态
    const user1 = `<设定集>\n${blueLightWorldbook || '（无角色卡蓝灯设定）'}\n</设定集>\n\n<角色状态>\n${characterStates}\n</角色状态>`;

    // Message 3: user：当前剧情
    const user2 = `<当前剧情>\n${cleanStory}\n</当前剧情>`;

    // 输出格式纯骨架范例 (不写详细业务内容，仅提供标准结构骨架)
    const OUTPUT_FORMAT_TEMPLATE = `## 输出格式范例（每个块必须严格闭环包含所有子块，严格按此结构骨架输出，禁止省略任何子块）：

<UBS_image>
<UBS_think>
S1 原文定格：……
S2 分级：……
S3 人物清点：……
S4 主体与构图：……
S5 外貌核对：……
S6 服装核对：……
S7 动作+表情+空间：……
S8 负面清单：……
S9 最终检查：……
</UBS_think>
position: 严格引用当前画面对应的正文原句（必须逐字复制当前剧情中的原句，15~35字，严禁自行改写或概括）；
desc: 中文一句话，概括画面核心叙事内容；
image###
Scene Composition: 场景环境与构图光影（英文短语组合）, sfw/nsfw;
Character 1 Prompt: 角色DNA外观, 此时服装, 核心姿态与微表情|centers:C3;
Character 1 UC: 负面提示词, 防崩坏词;
###
</UBS_image>

【强制输出铁律】
1. 立即直接以 <UBS_image> 开始输出，严禁输出任何开场白、前言、思考过程或解释文本！
2. 每个 <UBS_image> 块内必须完整包含 <UBS_think>、position、desc 和以 ### 闭合的 image### 提示词块，绝对禁止遗漏 image### 子块！
3. 连续完整输出全部 ${rollCount} 个 <UBS_image> 块，严禁中途漏写标签或提前闭合。
4. 【正文原句定位铁律】：position 必须是能直接在当前剧情正文中逐字搜到的原句摘录（复制原文连续一句话，严禁自行概括，严禁更改任何字词）！系统根据这句原话精准把图片嵌入到正文对应段落下方。`;

    // Message 4: system：提示词设定你是谁，怎么生成 结尾强调生成多少张，并插入输出格式范例
    const sys2 = `你是一名专业插画导演兼摄影指导。阅读上述<设定集>、<角色状态>与<当前剧情>，在人物登场、动作交锋、情感转折、精彩或激情场景处挑选最具画面感的瞬间，为每张画面撰写结构化英文生图提示词。必须严格遵照下列生图要求与输出格式范例输出 <UBS_image> 块：\n\n${DIRECTOR_REQUIREMENT_PROMPT}\n\n## 张数要求（最高优先级铁律）\n本轮必须严格且只能输出 ${rollCount} 个 <UBS_image> 块，不多不少！严格以 <UBS_image> 开始、以 </UBS_image> 结束。\n\n${OUTPUT_FORMAT_TEMPLATE}`;

    const messages = [
      { role: 'system', content: sys1 },
      { role: 'user', content: user1 },
      { role: 'user', content: user2 },
      { role: 'system', content: sys2 }
    ];

    let aiOutput = '';
    try {
      console.log(`[状态栏绘图] 正在调用 LLM 导演生成正文插图 (四阶段组装: 蓝灯设定集+在场角色状态+当前剧情, 目标张数: ${rollCount} 张)...`);
      aiOutput = await callLlm(messages, { temperature: 0.7 });
    } catch (err) {
      console.error('[状态栏绘图] 调用 LLM 插画导演失败:', err);
      return { ok: false, error: '调用 LLM 插画导演失败: ' + (err.message || err) };
    }

    // 解析出插图块 (全量提取，严禁人为截断张数)
    const imageBlocks = parseImageBlocks(aiOutput);
    if (!imageBlocks.length) {
      console.warn('[状态栏绘图] 未能从 LLM 输出中提取出有效的 <UBS_image> 块');
      return { ok: false, error: '未能从 LLM 输出中提取出有效的 <UBS_image> 块' };
    }

    const intervalSec = Math.max(0, parseInt(s.drawIntervalSeconds, 10) || 0);
    let taskResults = [];

    if (intervalSec > 0 && imageBlocks.length > 1) {
      console.log(`[状态栏绘图] 检测到设置了生图冷却间隔 ${intervalSec} 秒，启用防频控排队串行调度生成 ${imageBlocks.length} 张插图...`);
      for (let index = 0; index < imageBlocks.length; index++) {
        if (index > 0) {
          console.log(`[状态栏绘图] 等待防频控冷却间隔 ${intervalSec} 秒后发起下一张生图任务...`);
          await new Promise(r => setTimeout(r, intervalSec * 1000));
        }
        const block = imageBlocks[index];
        try {
          console.log(`[状态栏绘图] [排队任务 ${index + 1}/${imageBlocks.length}] 发起生图请求: ${block.description || block.promptText.slice(0, 50)}`);
          const gen = await generateImage(block.promptText, { size: '1024x1024' });
          const imgData = gen.dataUrl || gen.url;
          const saved = await uploadImage(imgData, 'story-image', 'scene');
          const storyItem = {
            id: 'story_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            path: saved.path,
            promptText: block.promptText,
            description: block.description,
            positionQuote: block.positionQuote,
            createdAt: Date.now()
          };
          console.log(`[状态栏绘图] [排队任务 ${index + 1}/${imageBlocks.length}] 生图并保存成功: ${saved.path}`);
          taskResults.push({
            ok: true,
            index,
            storyItem,
            result: {
              path: saved.path,
              markdown: `![正文插图](${saved.path})`,
              positionQuote: block.positionQuote
            }
          });
        } catch (err) {
          console.error(`[状态栏绘图] [排队任务 ${index + 1}/${imageBlocks.length}] 单张生图失败:`, err);
          taskResults.push({ ok: false, index, error: err });
        }
      }
    } else {
      console.log(`[状态栏绘图] 冷却间隔为 0 秒，开始极速并发生成 ${imageBlocks.length} 张插图...`);
      const tasks = imageBlocks.map(async (block, index) => {
        try {
          console.log(`[状态栏绘图] [并发任务 ${index + 1}/${imageBlocks.length}] 发起生图请求: ${block.description || block.promptText.slice(0, 50)}`);
          const gen = await generateImage(block.promptText, { size: '1024x1024' });
          const imgData = gen.dataUrl || gen.url;
          const saved = await uploadImage(imgData, 'story-image', 'scene');

          const storyItem = {
            id: 'story_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            path: saved.path,
            promptText: block.promptText,
            description: block.description,
            positionQuote: block.positionQuote,
            createdAt: Date.now()
          };

          console.log(`[状态栏绘图] [并发任务 ${index + 1}/${imageBlocks.length}] 生图并保存成功: ${saved.path}`);
          return {
            ok: true,
            index,
            storyItem,
            result: {
              path: saved.path,
              markdown: `![正文插图](${saved.path})`,
              positionQuote: block.positionQuote
            }
          };
        } catch (err) {
          console.error(`[状态栏绘图] [并发任务 ${index + 1}/${imageBlocks.length}] 单张生图失败:`, err);
          return { ok: false, index, error: err };
        }
      });
      taskResults = await Promise.all(tasks);
    }
    // 按原始顺序筛选成功的插图结果
    const successfulTasks = taskResults.filter(t => t && t.ok);
    const insertedResults = successfulTasks.map(t => t.result);
    const newStoryItems = successfulTasks.map(t => t.storyItem);

    if (newStoryItems.length > 0) {
      const curStories = s.storyImages || [];
      const updatedStories = [...newStoryItems.slice().reverse(), ...curStories];
      store()?.updateSettings({ storyImages: updatedStories });
    }

    // 将生成的插图智能定位并回写到正文中
    // 铁律契约：如果用户配置了正文标签 (如 <con> ... </con>)，正文插图必须且只能插入在该标签内部，绝不越界到思考块或标签外部！
    let updatedStoryText = storyText;
    if (insertedResults.length > 0) {
      const tagRange = findTargetTagRangeInStory(storyText);
      if (tagRange) {
        console.log(`[状态栏绘图] 识别到正文限定标签，插图将严格限制在标签内容内部插入`);
        const targetText = tagRange.inner;
        const insertionsWithIdx = insertedResults.map(item => {
          const lineIdx = locateTargetLineIndex(targetText, item.positionQuote);
          return {
            markdown: item.markdown,
            lineIndex: lineIdx,
            positionQuote: item.positionQuote
          };
        });
        const updatedInner = insertImagesIntoStoryText(targetText, insertionsWithIdx);
        updatedStoryText = tagRange.before + updatedInner + tagRange.after;
      } else {
        const insertionsWithIdx = insertedResults.map(item => {
          const lineIdx = locateTargetLineIndex(storyText, item.positionQuote);
          return {
            markdown: item.markdown,
            lineIndex: lineIdx,
            positionQuote: item.positionQuote
          };
        });
        updatedStoryText = insertImagesIntoStoryText(storyText, insertionsWithIdx);
      }

      if (options.mesId !== undefined || options.autoWriteBack) {
        await writeBackToTavernChat(options.mesId, updatedStoryText);
      }

      // 绘图完成提示音：开启自动正文绘图且设置中开启了提示音时自动播放
      if (s.storyImageSoundEnabled !== false) {
        playDrawNotificationSound();
      }
    }

    return {
      ok: insertedResults.length > 0,
      images: insertedResults,
      updatedStoryText
    };
    } finally {
      if (targetMesId !== null) {
        setStoryRegenLoading(targetMesId, false);
      }
    }
  }

  /**
   * 播放绘图完成提示音 (采用 Web Audio API 原生双和弦振荡器合成，零外部资源依赖)
   */
  function playDrawNotificationSound() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const actx = new AudioContextClass();
      const now = actx.currentTime;

      const osc1 = actx.createOscillator();
      const osc2 = actx.createOscillator();
      const gainNode = actx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(880, now + 0.12);
      osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.28); // D6

      gainNode.gain.setValueAtTime(0.15, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(actx.destination);

      osc1.start(now);
      osc1.stop(now + 0.14);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.45);

      osc2.onended = () => {
        actx.close().catch(() => {});
      };
    } catch (e) {
      console.warn('[状态栏绘图] 播放完成提示音失败:', e);
    }
  }

  window.STATUSBAR_DRAW = {
    fetchModelList,
    generateImage,
    uploadImage,
    generateAvatar,
    triggerAutoPortraitUpdate,
    generateStoryImages,
    handleManualStoryImageGeneration,
    triggerLatestStoryImageGeneration,
    injectStoryRegenButtons,
    stripStoryImages,
    getCharacterCardBlueLightWorldbook,
    getAllPresentCharacterStates,
    applySillyTavernDisplayRegex,
    extractTaggedStoryContent,
    findTargetTagRangeInStory,
    normalizeTagPattern,
    getLatestAiStoryText,
    getCleanStoryText,
    DIRECTOR_REQUIREMENT_PROMPT,
    parseImageBlocks,
    playDrawNotificationSound
  };

  console.log('[通用状态栏] 绘图引擎 statusbar-draw.js (含完整万字导演Prompt与角色卡世界书聊天记录深度融合) 加载完毕');
})();

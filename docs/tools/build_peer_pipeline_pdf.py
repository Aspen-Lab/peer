"""Reproducible Chinese PDF explainer. Not application implementation."""
from pathlib import Path
from math import atan2, cos, sin, pi
from xml.sax.saxutils import escape
import json
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/pdf/peer-pipeline-guide.zh-CN.pdf'
QA = ROOT / 'tmp/pdfs/peer-pipeline'
OUT.parent.mkdir(parents=True, exist_ok=True)
QA.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('CN', 'C:/Windows/Fonts/msyh.ttc', subfontIndex=0))
pdfmetrics.registerFont(TTFont('CNB', 'C:/Windows/Fonts/msyhbd.ttc', subfontIndex=0))
W, H = landscape(A4)
INK = HexColor('#173C2C')
GREEN = HexColor('#087038')
PALE = HexColor('#DDF3E6')
LINE = HexColor('#9BCAB0')
MUTED = HexColor('#546B60')
GRAY = HexColor('#F2F5F3')
GOLD = HexColor('#8C6020')
CREAM = HexColor('#FBF3E3')
WHITE = HexColor('#FFFFFF')
c = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
c.setTitle('Peer 论文筛选机制图解：收集、筛选、评分与每日推送')
c.setAuthor('Peer')
c.setSubject('2026-09-21 用户确认的升级方案；包含当前实现对照；非上线说明')
checks = []
page_no = 0


def text(x, top, value, size=12, bold=False, color=INK, align='left'):
    c.setFillColor(color)
    c.setFont('CNB' if bold else 'CN', size)
    fn = c.drawCentredString if align == 'center' else c.drawRightString if align == 'right' else c.drawString
    fn(x, H - top - size, value)


def para(x, top, width, value, size=12.3, leading=20, color=INK, bold=False, maxh=None, align=0):
    style = ParagraphStyle('body', fontName='CNB' if bold else 'CN', fontSize=size,
                           leading=leading, textColor=color, wordWrap='CJK', alignment=align)
    p = Paragraph(escape(value).replace('\n', '<br/>'), style)
    pw, ph = p.wrap(width, 1000)
    if maxh is not None and ph > maxh + .1:
        raise ValueError(f'Page {page_no}: text overflows {ph}>{maxh}: {value[:35]}')
    if top + ph > H - 32:
        raise ValueError(f'Page {page_no}: footer collision: {value[:35]}')
    checks.append({'page': page_no, 'x': x, 'top': top, 'width': width, 'height': ph, 'text': value[:60]})
    p.drawOn(c, x, H - top - ph)
    return ph


def box(x, top, width, height, label, fill=PALE, size=11.3, border=LINE, color=GREEN):
    c.setFillColor(fill)
    c.setStrokeColor(border)
    c.setLineWidth(.6)
    c.roundRect(x, H-top-height, width, height, 11, fill=1, stroke=1)
    style = ParagraphStyle('node', fontName='CNB', fontSize=size, leading=size*1.38,
                           textColor=color, wordWrap='CJK', alignment=1)
    p = Paragraph(escape(label).replace('\n','<br/>'),style)
    _, ph = p.wrap(width-16, height)
    if ph > height-10:
        raise ValueError(f'Node overflow {label}: {ph} in {height}')
    p.drawOn(c, x+8, H-top-height+(height-ph)/2)


def arrow(points, color=LINE, dashed=False, head=True, weight=1):
    c.setStrokeColor(color)
    c.setLineWidth(weight)
    c.setDash(3, 2) if dashed else c.setDash()
    p = c.beginPath()
    p.moveTo(points[0][0], H-points[0][1])
    for x, y in points[1:]:
        p.lineTo(x, H-y)
    c.drawPath(p)
    c.setDash()
    if head:
        x,y=points[-1]; a,b=points[-2]
        angle=atan2(y-b, x-a)
        for offset in (-pi/6,pi/6):
            c.line(x,H-y,x-5*cos(angle+offset),H-(y-5*sin(angle+offset)))


def page(title, subtitle, tag='已确认方案 / 尚待实现'):
    global page_no
    if page_no:
        c.showPage()
    page_no += 1
    c.setFillColor(WHITE); c.rect(0,0,W,H,fill=1,stroke=0)
    text(40,22,'PEER  /  RESEARCH BRIEFING',10,bold=True,color=GREEN)
    text(W-40,22,tag,10,color=MUTED,align='right')
    text(40,45,title,25,bold=True)
    text(40,82,subtitle,11.3,color=MUTED)
    c.setStrokeColor(LINE); c.setLineWidth(.6); c.line(40,32,W-40,32)
    text(40,H-25,'2026-09-21  ·  中文机制说明  ·  数量为上限，不为凑数而推荐',9,color=MUTED)
    text(W-40,H-25,f'{page_no:02d} / 07',9,color=MUTED,align='right')


def note(x, top, width, heading, body, height=98, fill=GRAY):
    c.setFillColor(fill); c.roundRect(x,H-top-height,width,height,10,fill=1,stroke=0)
    text(x+16,top+13,heading,13,bold=True)
    para(x+16,top+39,width-32,body,size=11.6,leading=18,maxh=height-45)


def section(x, top, width, heading, body):
    text(x,top,heading,15,bold=True,color=GREEN)
    return para(x,top+29,width,body,maxh=150)+29


# 1. Redraw the user's preferred branching diagram, with the corrected return path.
page('从研究问题，到每天不重复的论文卡片',
     '沿用你喜欢的绿色流程图；关键修正：回流的是“未展示候选”，不是“未读卡片”。')
box(40,115,184,45,'项目描述与 challenge\n决定真正要找什么')
box(40,190,184,49,'研究说明卡\n免费词库、关键词、正反例')
arrow([(132,160),(132,190)])
xs=[40,158,276,394,512]
labs=['关键词搜索','OpenAlex\n语义搜索','引用网络','Seed 相似论文','学科分类搜索']
arrow([(132,239),(132,266)],head=False)
arrow([(92,266),(564,266)],head=False)
for x,label in zip(xs,labs):
    arrow([(x+52,266),(x+52,289)])
    box(x,289,104,49,label,size=11)
    arrow([(x+52,338),(x+52,365)],head=False)
arrow([(92,365),(564,365)],head=False)
arrow([(362,365),(362,386)])
box(230,386,264,43,'候选并集\n公共结果可复用，私人查询隔离')
arrow([(362,429),(362,447)])
box(230,447,264,43,'普通程序\n去重、规则检查、RRF 合并投票')
arrow([(362,490),(362,507)])
box(230,507,264,45,'最多 50 篇\n复用旧判断，只把需要的交给 Jev')
arrow([(494,529),(633,529),(633,137),(651,137)],color=GREEN)
box(651,115,155,45,'个人最终池\n最多 30 篇')
arrow([(728,160),(728,197)])
box(651,197,155,51,'选出前 10 篇\nGemini 短报告按需补齐')
arrow([(728,248),(728,287)])
box(651,287,155,51,'提前保存每日 feed\n打开主页直接读取')
arrow([(728,338),(728,378)])
box(651,378,155,65,'主页批次成功呈现\n这 10 篇记入已推送名单\n未来不再自动推荐',size=10.4)
arrow([(806,137),(824,137),(824,509),(806,509)],color=GOLD,dashed=True)
box(651,484,155,60,'未展示的最多 20 篇\n仍合格才进入次日竞争',fill=CREAM,border=HexColor('#D9C69E'),color=GOLD,size=11)
arrow([(651,514),(611,514),(611,468),(494,468)],color=GOLD,dashed=True)
para(262,122,344,'先尽量找全，再判断是否有用。\nAI 负责理解，程序负责规则，\n数据库负责记住做过的工作。',size=15,leading=27,maxh=105)
para(40,452,165,'实线：本轮处理\n虚线：未展示候选回流\n\n已推送 ≠ 已读完\n没点击 ≠ 不喜欢',size=11.2,leading=19,maxh=104)

# 2. Current vs confirmed target: avoid presenting the target as shipped.
page('现在已经有什么？这次具体改什么？',
     '第 1 页是已确认的目标结构，不是当前线上系统已经具备的全部能力。','当前代码对照 / 非上线声明')
text(40,122,'当前代码已有',17,bold=True)
text(437,122,'已确认的升级',17,bold=True,color=GREEN)
rows=[
 ('收集','多个学术信源普通搜索；部分导师论文引用邻居。','保留原信源；加入语义、seed 推荐和更完整的引文通道。'),
 ('筛选','去重、时间检查；还存在字面关键词硬门槛。','多路命中都可入围；仍遵守明确排除项，不因换了说法就丢弃。'),
 ('评分','本地词汇与规则；启用 AI 时，对前 50 篇做生成式重排。','程序投票选候选；Jev 判断专业含义；Gemini 只解释少量精选。'),
 ('保存','已有每日 pool，会存论文以及 AI 排名、理由。','拆成公共检索与个人判断；防止相同关键词的不同项目串用理由。'),
 ('推送','已有展示/阅读记录和定时摘要入口；还不是永久不重复机制。','长期记录已推送论文；仅未展示候选续存；提前准备、刷新排队。'),
]
for i,(label,old,new) in enumerate(rows):
    t=165+i*67
    text(40,t,label,11,bold=True,color=MUTED)
    para(90,t,309,old,size=11.4,leading=18,maxh=55)
    para(437,t,365,new,size=11.4,leading=18,maxh=55)
    c.setStrokeColor(HexColor('#E0E8E2'));c.line(40,H-t-57,802,H-t-57)
para(40,514,762,'当前的关键词与缓存风险来自代码核查；并未证明已发生用户信息泄露。本次只更新设计文档与说明 PDF，没有接入 Jev 或部署新流程。',size=11.2,leading=18,maxh=40,color=MUTED)

# 3. Collecting.
page('Collecting：先让好论文有机会进来',
     '像请五位不同专长的图书管理员一起找书，而不是只认封面上的某个字。')
note(40,118,762,'例子：用户真正要找的是什么？',
     '“我研究员工的角色冲突怎样影响离职意向，希望找到适合问卷数据的方法。”这整句话比单独的 conflict 更有用。',height=90,fill=PALE)
channels=[
 ('关键词','找准确名称、专有名词。','原有学术信源继续使用。'),
 ('语义搜索','找“意思相近、用词不同”的论文。','使用项目描述，不只输入一个词。'),
 ('引用网络','顺着相关论文的参考文献与被引用关系找。','只扩展有限层数，避免无限爬取。'),
 ('Seed 推荐','用用户认可的论文作为样板，寻找相似研究。','测试 Semantic Scholar，也比较 OpenAlex 路径。'),
 ('学科分类','从相关领域补充候选。','分类只提供线索，不等于一定适合项目。'),
]
for i,(a,b,d) in enumerate(channels):
    t=231+i*48
    text(45,t,a,13,bold=True,color=GREEN)
    text(157,t,b,11.5)
    text(157,t+20,d,10.8,color=MUTED)
note(40,477,762,'Semantic Scholar 不提前移出测试方案',
     '比较它和 OpenAlex 各自找到什么、合并后增加多少好论文。公开、免费或测试阶段不自动覆盖所有用途；实际测试仍须符合许可，商业用途另行确认。',height=82,fill=CREAM)

# 4. Filtering and scoring.
page('Filtering + Scoring：先检查，再决定谁排前面',
     '筛选问“有没有资格”；评分问“谁更值得先看”。两者不能混成一次关键词判断。')
section(40,121,356,'01  程序做明确、可重复的检查',
        '按 DOI 等身份去重；检查用户明确的排除项、日期范围和已推送名单。语义、引文或 seed 找来的论文，不要求再次通过字面关键词门槛。')
section(437,121,365,'02  RRF 像按名次投票',
        '每个检索通道交一份排名。多个通道都排得靠前的论文，会得到更多支持。一个通道换十种搜索词，不能因此获得十倍投票权。')
box(40,259,162,48,'候选并集',size=13)
box(240,259,162,48,'程序筛选与投票',size=13)
box(440,259,162,48,'最多 50 篇供判断',size=13)
box(640,259,162,48,'最终最多 30 篇',size=13)
for a,b in [(202,240),(402,440),(602,640)]:arrow([(a,283),(b,283)],color=GREEN)
section(40,340,356,'03  Jev 读上下文，回答小问题',
        'conflict 是员工角色冲突，还是利益冲突声明？它是研究核心吗？人群和方法是否符合要求？对当前 challenge 是否有帮助？程序综合这些答案来排序。')
section(437,340,365,'04  不知道，就说信息不足',
        '摘要没有说明的方法，不能假装已经知道。缺摘要不等于不相关；Jev 也可能理解错误。没有可用 AI 或预算时，保留诚实的程序排序，不编造判断。')
para(40,510,762,'Jev 是判断员，Gemini 是解释员。两者都不能救回从未被搜到、或在前面错误丢弃的论文。',size=13,bold=True,color=GREEN,maxh=38)

# 5. Delivery semantics.
page('Feeding：推送过就不重现，没展示过才可续存',
     '这条规则看的是“是否在主页推送过”，不是“有没有点开”，也不是“有没有读完”。')
box(40,127,178,54,'第一天个人最终池\n30 篇',size=14)
arrow([(218,154),(263,154)],color=GREEN)
box(263,118,247,73,'主页呈现 10 篇\n2 篇打开 + 8 篇没打开\n全部记入长期已推送名单',size=12)
arrow([(386,191),(386,225)],color=GREEN)
box(263,225,247,54,'后续新批次不再推荐这 10 篇\n当天页面与往期记录仍可访问',size=11.8)
arrow([(129,181),(129,327),(263,327)],color=GOLD,dashed=True)
box(263,300,247,54,'另外 20 篇未展示\n检查是否仍适合当前项目',fill=CREAM,border=HexColor('#D9C69E'),color=GOLD,size=12)
arrow([(510,327),(552,327)],color=GOLD,dashed=True)
box(552,292,249,70,'与第二天新候选一起竞争\n形成新的最多 30 篇\n再选出新的 10 张卡片',size=12)
note(552,118,249,'没点击，不等于不喜欢',
     '可以为了保持新鲜而不再推送，但不能据此惩罚整个研究主题。',height=135)
section(40,400,355,'什么时候算“已推送”？',
        '用户打开主页，整批卡片成功呈现后，批次内论文统一记账。不要求逐张点击。后台只生成了结果、用户没来过，不算已经看过。')
section(437,400,365,'永久名单不能跟每日缓存一起清空',
        '同一篇论文换信源、换设备或换项目，也不能自动再次推荐。邮件记录单独处理。新候选不足时少推几篇，不用旧论文凑满十篇。')

# 6. Pool and budget.
page('Pool：共享找回来的论文，不共享私人的判断',
     '把 pool 理解成书篮，把缓存指纹理解成篮子上的条形码。条形码相同，才可以复用。')
cards=[
 (40,'公共论文库','题目、论文 ID、来源与可合法缓存的元数据。\n\n相同论文尽量只保存一份；不代表可以随意共享 PDF 全文。'),
 (299,'检索结果篮子','某个检索配方找到了哪些论文。\n\n公共概念可共享；私人项目查询必须隔离。同一个词，不同含义，不是同一个配方。'),
 (558,'个人工作台','项目说明、Jev 判断、推荐理由、最终池、报告与已推送名单。\n\n这些内容属于具体用户，不可跨用户串用。'),
]
for x,head,body in cards:
    note(x,122,244,head,body,height=188,fill=PALE)
section(40,345,355,'后台先准备，用户打开直接读',
        '队列像取号排队。同一个搜索任务合并处理，所有 worker 共用限速与预算。重复刷新先读缓存，不应每点一次就重复调用模型。')
section(437,345,365,'省钱靠不重复做已经做过的工作',
        '例如 50 篇待判断论文中，20 篇已有有效 Jev 判断，只需要新评 30 篇。这部分判断量减少 40%，不代表搜索或平台总费用也减少 40%。')
para(40,495,762,'公司密钥只放服务端。用户、全公司都要有额度上限；外部服务失败时展示最近有效结果与更新时间，不把失败说成“今天没有好论文”。',size=12.2,leading=20,maxh=52,color=GREEN,bold=True)

# 7. Sources and definitions.
page('把整套机制记成四句话',
     '收集要广，筛选要准，评分看项目，推送不重复。','阅读指南 / 资料与版本')
for i,(a,b) in enumerate([
 ('Collecting / 收集','不同通道共同找论文，降低漏掉好论文的机会。'),
 ('Filtering / 筛选','去重复、守住明确要求；不再只凭有没有某个词决定去留。'),
 ('Scoring / 评分','先由程序合并名次，再由 Jev 判断意思；最有帮助的排前面。'),
 ('Feeding / 推送','少量卡片提前准备；已推送永久排除，未展示候选次日再竞争。'),
]):
    t=120+i*46
    text(40,t,a,13,bold=True,color=GREEN)
    text(259,t,b,11.7)
text(40,323,'词库像专业地图，不是自动理解器',14,bold=True)
para(40,351,762,'第一批采用 OpenAlex 分类、TheSoz 社会科学词库、STW 经济学词库，并保留许可和署名。专业含义仍结合用户说明与正反例判断。未核实免费商业复用许可的 APA 等词库不导入。',size=11.5,leading=18,maxh=55)
text(40,416,'资料入口（可点击）',12,bold=True,color=MUTED)
links=[
 ('OpenAlex 语义搜索','https://help.openalex.org/api/semantic-search/'),
 ('Jev 结构化判断','https://docs.typesafe.ai/introduction'),
 ('Semantic Scholar 使用条款','https://api.semanticscholar.org/license/'),
 ('TheSoz 许可','https://data.gesis.org/cvbrowser/en/about'),
 ('STW 许可','https://www.zbw.eu/en/about-us/information-organisation/stw-thesaurus-for-economics/access-information'),
]
for i,(label,url) in enumerate(links):
    x=40+(i%3)*259;top=444+(i//3)*28
    text(x,top,label,10.8,color=GREEN)
    c.linkURL(url,(x,H-top-16,x+240,H-top+2),relative=0,thickness=0)
para(40,514,762,'版本：2026-09-21 用户确认的修订方案。当前代码对照见第 2 页；详细实现合同与测试标准见仓库中的中文计划报告和 ABC handoff。本 PDF 不是功能上线或准确率保证。',size=10.7,leading=17,maxh=40,color=MUTED)
c.save()
reader=PdfReader(str(OUT))
assert len(reader.pages)==7
alltext='\n'.join(p.extract_text() or '' for p in reader.pages)
for phrase in ['未展示','已推送','Semantic Scholar','信息不足','当前代码']:
    assert phrase in alltext,phrase
assert '\ufffd' not in alltext
audit={'pages':len(reader.pages),'bytes':OUT.stat().st_size,'font':'embedded Microsoft YaHei TrueType',
       'layout_blocks':checks,'text_checks':'pass; visual inspection required separately'}
(QA/'layout-check.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'pdf':str(OUT),'pages':7,'bytes':OUT.stat().st_size,'text_checks':'pass'},ensure_ascii=False))

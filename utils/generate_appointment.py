#!/usr/bin/env python3
"""
DutyLaunch HRMS - Appointment Letter PDF Generator
Produces a professional A4 PDF matching the reference letterhead exactly.
Usage: python3 generate_appointment.py <fields_json_path>
"""
import sys, json, io, os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate,
    Paragraph, Spacer, HRFlowable, KeepTogether, ListFlowable, ListItem
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus.flowables import Flowable

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import glob as _glob

def _find_dejavu():
    """Find DejaVuSans.ttf on Linux, macOS, or Windows."""
    candidates = [
        # Linux (Debian/Ubuntu)
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        # macOS — Homebrew font-dejavu
        '/opt/homebrew/share/fonts/dejavu-fonts-ttf/DejaVuSans.ttf',
        '/usr/local/share/fonts/DejaVuSans.ttf',
        '/opt/homebrew/share/fonts/DejaVuSans.ttf',
        # macOS — system fonts
        '/Library/Fonts/DejaVuSans.ttf',
        '/System/Library/Fonts/DejaVuSans.ttf',
        # macOS — user fonts
        os.path.expanduser('~/Library/Fonts/DejaVuSans.ttf'),
        # Windows
        'C:/Windows/Fonts/DejaVuSans.ttf',
    ]
    # Also glob common font dirs
    for pat in [
        '/usr/share/fonts/**/DejaVuSans.ttf',
        '/opt/homebrew/share/fonts/**/DejaVuSans.ttf',
        '/usr/local/share/fonts/**/DejaVuSans.ttf',
    ]:
        matches = _glob.glob(pat, recursive=True)
        if matches:
            candidates.insert(0, matches[0])
    for p in candidates:
        if os.path.exists(p):
            return p
    return None

def _sibling(base, suffix):
    """Replace DejaVuSans.ttf with DejaVuSans-Bold.ttf etc."""
    return base.replace('DejaVuSans.ttf', f'DejaVuSans{suffix}.ttf')

_FONT = 'Helvetica'
_FONT_BOLD = 'Helvetica-Bold'

_dv = _find_dejavu()
if _dv and os.path.exists(_dv):
    try:
        pdfmetrics.registerFont(TTFont('DocSans',        _dv))
        pdfmetrics.registerFont(TTFont('DocSans-Bold',   _sibling(_dv, '-Bold')))
        pdfmetrics.registerFont(TTFont('DocSans-Italic', _sibling(_dv, '-Oblique')))
        pdfmetrics.registerFont(TTFont('DocSans-BI',     _sibling(_dv, '-BoldOblique')))
        from reportlab.pdfbase.pdfmetrics import registerFontFamily
        registerFontFamily('DocSans',
            normal='DocSans', bold='DocSans-Bold',
            italic='DocSans-Italic', boldItalic='DocSans-BI')
        _FONT = 'DocSans'
        _FONT_BOLD = 'DocSans-Bold'
    except Exception:
        pass  # Fall back to Helvetica (₹ will render as box, rest is fine)


# ── A4 dimensions ─────────────────────────────────────────────────────────────
PAGE_W, PAGE_HEIGHT = A4          # 595.28 x 841.89 pt  (210mm x 297mm)

# ── Letterhead zones (measured from reference PDF) ──────────────────────────
# Header: top ~87pt (30.7mm) — logos + blue graphic
# Footer: bottom ~90pt (31.8mm) — phone/email row + blue address bar
# Body margins: L=55pt, R=55pt, top below header, bottom above footer

HDR_H     = 87.0   # pt  — height of header image
FTR_H     = 90.0   # pt  — height of footer image
ML        = 55.0   # left margin
MR        = 55.0   # right margin
BODY_TOP  = HDR_H + 6    # top of body frame from bottom-of-page
BODY_BOT  = FTR_H + 6    # bottom padding above footer
CW        = PAGE_W - ML - MR  # usable content width

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR  = os.path.dirname(SCRIPT_DIR)
ASSETS      = os.path.join(SERVER_DIR, 'uploads', 'letterhead')
HEADER_PNG  = os.path.join(ASSETS, 'header.png')
FOOTER_PNG  = os.path.join(ASSETS, 'footer.png')

# ── Styles matching reference typography ─────────────────────────────────────
def mkS(name, **kw):
    base = dict(
        fontName=_FONT, fontSize=9.5, leading=14.5,
        spaceAfter=0, spaceBefore=0,
        textColor=colors.HexColor('#1a1a1a'),
    )
    base.update(kw)
    return ParagraphStyle(name, **base)

sBody   = mkS('body',   alignment=TA_JUSTIFY, spaceAfter=8)
sBodyL  = mkS('bodyL',  alignment=TA_LEFT,    spaceAfter=8)
sHead   = mkS('head',   fontName=_FONT_BOLD, fontSize=9.5,
               spaceBefore=10, spaceAfter=4)
sTitle  = mkS('title',  fontName=_FONT_BOLD, fontSize=13,
               alignment=TA_CENTER, spaceAfter=14, spaceBefore=4)
sBullet = mkS('bullet', alignment=TA_JUSTIFY,
               leftIndent=14, firstLineIndent=0, spaceAfter=3)

def P(text, style=sBody):    return Paragraph(text, style)
def PL(text, style=sBodyL):  return Paragraph(text, style)
def PHead(text):                 return Paragraph(text, sHead)
def sp(n):                   return Spacer(1, n)

# ── Page background (header + footer images on every page) ────────────────────
def draw_page_background(canv, doc):
    canv.saveState()
    # Header image — anchored to top of page
    if os.path.exists(HEADER_PNG):
        canv.drawImage(HEADER_PNG, 0, PAGE_HEIGHT - HDR_H,
                       width=PAGE_W, height=HDR_H,
                       preserveAspectRatio=False, mask='auto')
    # Footer image — anchored to bottom of page
    if os.path.exists(FOOTER_PNG):
        canv.drawImage(FOOTER_PNG, 0, 0,
                       width=PAGE_W, height=FTR_H,
                       preserveAspectRatio=False, mask='auto')
    canv.restoreState()

# ── Build story ────────────────────────────────────────────────────────────────
DEFAULT_DUTIES = [
    'Managing technical projects from requirement gathering through successful delivery.',
    'Leading software development, integration and implementation activities.',
    'Understanding client requirements and converting them into practical technical solutions.',
    'Coordinating with clients, developers, vendors, designers and internal teams.',
    'Planning and monitoring project timelines, milestones, deliverables, quality and client satisfaction.',
    'Developing, reviewing, testing, debugging and maintaining software applications as assigned.',
    'Supporting deployment, maintenance, troubleshooting and post-delivery technical support.',
    'Supporting technical product/service sales, demonstrations, proposals and client conversions where required.',
    'Identifying opportunities for additional technical products, services, automation and process improvements.',
    'Providing technical guidance, documentation and project updates to management.',
    'Maintaining appropriate technical documentation, source-control practices and project records.',
    'Ensuring timely completion and delivery of assigned work.',
    'Performing other reasonable duties and responsibilities assigned by the Company from time to time.',
]

ROLE_DUTIES = {
    'Sales Executive': [
        'Identifying and approaching potential clients to generate new business opportunities.',
        'Managing the complete sales cycle from prospecting to closure.',
        'Maintaining and growing relationships with existing clients.',
        'Achieving monthly and quarterly sales targets as communicated by management.',
        'Preparing and presenting proposals, quotations and product/service demonstrations.',
        'Coordinating with internal teams to ensure timely delivery and client satisfaction.',
        'Maintaining accurate records of sales activities, leads and client interactions.',
        'Reporting sales progress and pipeline updates to the reporting manager.',
        'Gathering market intelligence and providing feedback on competitive landscape.',
        'Participating in marketing events, trade shows and client meetings as required.',
        'Ensuring professional communication and conduct with all clients and stakeholders.',
        'Performing other reasonable duties and responsibilities assigned by the Company from time to time.',
    ],
    'Business Development Executive': [
        'Identifying, evaluating and pursuing new business opportunities and strategic partnerships.',
        'Developing and maintaining a robust pipeline of qualified business prospects.',
        'Conducting market research to identify trends, opportunities and competitive positioning.',
        'Preparing business proposals, presentations and partnership agreements.',
        'Coordinating with senior management on strategic business initiatives.',
        'Building and maintaining long-term relationships with clients, partners and stakeholders.',
        'Tracking and reporting on business development activities, conversions and revenue targets.',
        'Collaborating with product, marketing and operations teams on go-to-market strategies.',
        'Participating in industry events, networking activities and client meetings.',
        'Supporting contract negotiations and commercial discussions as required.',
        'Performing other reasonable duties and responsibilities assigned by the Company from time to time.',
    ],
    'HR Executive': [
        'Assisting in end-to-end recruitment activities including job postings, screening and scheduling.',
        'Maintaining employee records, HR databases and documentation accurately.',
        'Supporting onboarding and offboarding processes for employees.',
        'Assisting with payroll processing, leave management and attendance tracking.',
        'Coordinating training programmes and employee development activities.',
        'Handling employee queries related to HR policies, benefits and procedures.',
        'Supporting performance review processes and appraisal documentation.',
        'Ensuring compliance with applicable labour laws and company HR policies.',
        'Preparing HR reports, dashboards and analytics for management review.',
        'Supporting employee engagement, welfare and culture initiatives.',
        'Performing other reasonable duties and responsibilities assigned by the Company from time to time.',
    ],
    'Project Manager': [
        'Planning, executing and delivering projects within defined scope, timeline and budget.',
        'Coordinating with cross-functional teams, clients and stakeholders throughout the project lifecycle.',
        'Defining project requirements, milestones, deliverables and success criteria.',
        'Monitoring project progress, identifying risks and implementing mitigation strategies.',
        'Conducting regular project status meetings and providing updates to senior management.',
        'Managing project documentation, change requests and version control.',
        'Ensuring quality standards are maintained throughout project delivery.',
        'Allocating and managing project resources effectively.',
        'Facilitating communication between technical teams and business stakeholders.',
        'Conducting post-project reviews and implementing lessons learned.',
        'Performing other reasonable duties and responsibilities assigned by the Company from time to time.',
    ],
}

def get_duties_for_role(designation, custom_duties=None):
    if custom_duties and len(custom_duties) > 0:
        return custom_duties
    # Try to match known roles
    d = designation.lower() if designation else ''
    for role_key, duties in ROLE_DUTIES.items():
        if role_key.lower() in d:
            return duties
    return DEFAULT_DUTIES

def build_story(f):
    duties = get_duties_for_role(f.get('designation',''), f.get('duties'))
    comp   = f.get('compensation','')
    cwords = f.get('compensationWords','')
    incpct = f.get('incentivePercent','15')
    co     = f.get('registeredCompanyName','DutyLaunch Solutions Private Limited')
    emp    = f.get('employeeFullName','')
    empf   = f.get('employeeFirstName','')
    desig  = f.get('designation','')
    doj    = f.get('joiningDate','')
    rm     = f.get('reportingManager','management/person')
    loc    = f.get('workLocation','')
    sig    = f.get('authorizedSignatoryName','Moqsood Ahmed')
    sigd   = f.get('authorizedSignatoryDesignation','Founder and CEO')
    dt     = f.get('dateOfIssue','')
    ol_dt  = f.get('offerLetterDate','')
    ol_doj = f.get('offerLetterJoiningDate','')

    s = []
    s.append(sp(4))

    # Title
    s.append(P('<b>APPOINTMENT LETTER</b>', sTitle))

    # Opening block
    s.append(PL(f'<b>Date:</b> {dt}'))
    s.append(sp(8))
    s.append(PL('<b>To,</b>'))
    s.append(PL(emp))
    s.append(PL(f'Subject: Appointment as {desig}'))
    s.append(sp(8))
    s.append(PL(f'Dear {empf or emp},'))
    s.append(sp(6))

    intro = (f'We are pleased to confirm your appointment with {co} (the \u201cCompany\u201d) as a {desig}. '
             f'This Appointment Letter records the terms and conditions of your employment')
    if ol_dt:
        intro += (f' and supersedes the joining-date reference contained in the Offer Letter dated '
                  f'{ol_dt} to the extent that the Offer Letter stated a joining date of '
                  f'{ol_doj or doj}.')
    else:
        intro += '.'
    intro += f' Your actual date of joining and commencement of employment is {doj}.'
    s.append(P(intro))

    # ── Sections ─────────────────────────────────────────────────────────────
    def sec(n, title, body):
        s.append(PHead(f'{n}. {title}'))
        s.append(P(body))

    sec('1','Appointment and Designation',
        f'You are appointed as {desig} with effect from {doj}. You will report to the '
        f'{rm} designated by the Company from time to time. The Company may reasonably modify '
        f'your reporting structure, responsibilities, projects, or allocation of work based on '
        f'business requirements without changing your substantive designation or agreed compensation '
        f'unless otherwise communicated in writing.')

    sec('2','Date of Joining',
        f'Your date of joining is {doj}. For employment, payroll, internal records and service '
        f'purposes, {doj} shall be treated as your commencement date with the Company.')

    if comp:
        sec('3','Compensation',
            f'Your monthly compensation is \u20b9{comp}/- (Rupees {cwords} Only), inclusive of '
            f'applicable Provident Fund (PF) and insurance contributions/benefits, wherever applicable '
            f'under the Company\u2019s policies and statutory requirements. Any applicable statutory '
            f'deductions or employer contributions will be dealt with in accordance with applicable '
            f'law and the Company\u2019s payroll practices.')
    else:
        sec('3','Compensation',
            'Your monthly compensation will be as communicated in writing, inclusive of applicable '
            'Provident Fund (PF) and insurance contributions/benefits wherever applicable under the '
            'Company\u2019s policies and statutory requirements.')

    sec('4','Performance-Based Incentive',
        f'In addition to the above compensation, you are eligible for a performance-based incentive '
        f'of up to {incpct}% of eligible revenue generated from technical products/services sold to '
        f'clients and attributable to your efforts. The incentive is not guaranteed compensation and '
        f'is subject to: (a) the revenue being attributable to your contribution; (b) successful '
        f'receipt of the relevant client payment by the Company; (c) verification and approval of the '
        f'revenue and incentive calculation by the Company; and (d) the applicable incentive policy '
        f'and payment cycle. The Company reserves the right to determine eligibility and calculation '
        f'methodology in accordance with its applicable policy.')

    s.append(PHead('5. Key Duties and Responsibilities'))
    s.append(P('Your responsibilities will include, but will not be limited to:'))
    for duty in duties:
        s.append(P(f'\u2022\u00a0 {duty}', sBullet))
    s.append(sp(4))

    sec('6','Working Hours, Location and Work Requirements',
        'You shall follow the working hours, attendance requirements, work location, remote/hybrid '
        'arrangements, meeting schedules and other operational requirements communicated by the Company '
        'from time to time. You are expected to remain reasonably available during agreed working hours '
        'and to attend client or internal meetings and project discussions as required for effective '
        'performance of your role.')

    sec('7','Professional Conduct',
        'You shall maintain professional conduct, discipline, integrity, honesty and respectful '
        'behaviour in all dealings with the Company, its directors, employees, clients, vendors and '
        'other stakeholders. You shall comply with reasonable instructions, policies, procedures, '
        'security requirements and professional standards of the Company.')

    sec('8','Confidentiality and Non-Disclosure',
        'During your employment, you may have access to confidential information relating to the '
        'Company, its clients, products, technology, source code, credentials, software architecture, '
        'business plans, pricing, proposals, contracts, documentation, customer information, financial '
        'information, marketing plans and other proprietary information. You shall keep such information '
        'strictly confidential and shall not disclose, copy, transfer, misuse or share it with any '
        'unauthorised person during or after employment. Company information shall be accessed and used '
        'only for legitimate Company purposes and in accordance with authorised access controls.')

    sec('9','Intellectual Property and Work Product',
        'All software, source code, scripts, documentation, designs, databases, technical solutions, '
        'processes, concepts, inventions, improvements, materials, configurations and other work product '
        'created, developed or substantially contributed to by you in the course of your employment or '
        'using Company resources shall belong to the Company, subject to applicable law and any separate '
        'written agreement. You shall promptly provide the Company with all materials and information '
        'reasonably necessary to record, maintain, protect, deploy or transfer such work product.')

    sec('10','Company Systems, Data and Security',
        'You shall use Company systems, accounts, repositories, devices, credentials, APIs, cloud '
        'services and other resources only for authorised business purposes. You must maintain '
        'appropriate password and access security, follow data-protection and information-security '
        'instructions, and immediately report any suspected unauthorised access, data loss, security '
        'incident or compromise of credentials. You shall not retain Company or client data on '
        'unauthorised personal systems or disclose credentials to third parties.')

    sec('11','Client and Vendor Communication',
        'Where you interact with clients or vendors on behalf of the Company, you shall communicate '
        'professionally and within the authority granted to you. You shall not make commitments, pricing '
        'assurances, contractual representations, refunds, discounts or other commercial commitments on '
        'behalf of the Company unless authorised to do so.')

    sec('12','Conflict of Interest',
        'You shall promptly disclose any actual or potential conflict of interest that may affect your '
        'responsibilities or the interests of the Company. You shall not use Company opportunities, '
        'confidential information, client relationships or resources for personal benefit or for the '
        'benefit of another business without prior written approval from the Company.')

    sec('13','Outside Work and Competing Activities',
        'During your employment, you shall not undertake outside work, consulting, freelancing or other '
        'professional activity that materially conflicts with your duties, uses Company confidential '
        'information or resources, interferes with your performance, or creates a conflict of interest. '
        'Any such activity requiring disclosure or approval shall be handled in accordance with Company '
        'policy and applicable law.')

    sec('14','Company Property and Return of Assets',
        'All Company property, including documents, devices, access cards, credentials, source code, '
        'repositories, files, customer information and other materials, shall remain Company property. '
        'Upon request or cessation of employment, you shall promptly return or hand over all Company '
        'property and information and, subject to applicable law, cease retaining copies or access to '
        'Company confidential information.')

    sec('15','Leave, Attendance and Company Policies',
        'Leave, attendance, holidays, payroll procedures, expense reimbursement and other employment '
        'administration matters shall be governed by applicable law and the Company\u2019s policies as '
        'communicated from time to time. You are expected to obtain the required approvals before taking '
        'planned leave and to maintain accurate attendance and work records where required.')

    sec('16','Statutory Deductions and Benefits',
        f'Any statutory deductions, contributions or benefits applicable to your employment shall be '
        f'administered in accordance with applicable law and the Company\u2019s payroll policies. '
        + (f'The stated monthly compensation of \u20b9{comp}/- is inclusive of applicable PF and '
           f'insurance components, wherever applicable, as stated in the Offer Letter.' if comp else
           'Applicable statutory deductions and benefits shall be communicated in writing.'))

    sec('17','Verification and Documentation',
        'Your appointment is subject to submission and verification of documents and information '
        'reasonably required by the Company for employment, payroll, statutory and compliance purposes. '
        'If any information or document submitted by you is found to be materially false, misleading '
        'or inaccurate, the Company may take appropriate action in accordance with applicable law and '
        'Company policy.')

    sec('18','Performance and Role Review',
        'Your performance may be reviewed periodically based on responsibilities, project delivery, '
        'quality, timelines, client satisfaction, technical contribution, teamwork, business contribution '
        'and other reasonable performance parameters applicable to your role. The Company may provide '
        'feedback and set objectives from time to time.')

    sec('19','Termination and Separation',
        'Your employment may be terminated or may otherwise come to an end in accordance with applicable '
        'law, the Company\u2019s applicable employment policies and any written terms separately '
        'communicated or agreed between you and the Company. On separation, you shall complete all '
        'reasonable handover requirements, return Company property, transfer project knowledge and '
        'deliverables, and comply with continuing confidentiality and intellectual-property obligations.')

    sec('20','Continuing Obligations',
        'Clauses concerning confidentiality, intellectual property, protection of Company and client '
        'information, return of Company property, data/security obligations and any other obligations '
        'which by their nature are intended to continue shall survive cessation of employment to the '
        'extent permitted by applicable law.')

    sec('21','Amendments and Company Policies',
        'The Company may introduce or amend reasonable policies, procedures and operational guidelines '
        'from time to time. Any amendment to material contractual terms will be communicated in writing '
        'where required. In the event of any inconsistency between this Appointment Letter and a later '
        'written agreement signed by both parties, the later agreement shall prevail to the extent of '
        'the inconsistency.')

    sec('22','Governing Law and Jurisdiction',
        'This Appointment Letter shall be governed by the laws applicable in India. Subject to '
        'applicable law, matters arising from this employment shall be subject to the jurisdiction of '
        'the competent courts/authorities having jurisdiction over the Company\u2019s registered/office '
        'location in Bengaluru, Karnataka.')

    sec('23','Acceptance',
        f'By signing below, you acknowledge that you have read, understood and accepted the terms of '
        f'this Appointment Letter and confirm your joining with the Company with effect from {doj}.')

    # ── Signature block ──────────────────────────────────────────────────────
    sig_block = [
        sp(16),
        PL(f'<b>For {co.upper()}</b>'),
        sp(4),
        PL('Authorized Signatory'),
        PL(f'Name: {sig}'),
        PL(f'Designation: {sigd}'),
        sp(24),
        PL('Signature: ______________________________'),
        PL(f'Date: {dt}'),
        sp(16),
        PL('<b>EMPLOYEE ACKNOWLEDGEMENT AND ACCEPTANCE</b>'),
        sp(6),
        P(f'I, {emp}, acknowledge that I have received, read and understood this Appointment Letter '
          f'and accept the terms and conditions of my employment with {co}.'),
        sp(10),
        PL(f'Employee Name: {emp}'),
        PL('Signature: ______________________________'),
        PL(f'Date: {dt}'),
    ]
    s.append(KeepTogether(sig_block))

    return s

def generate(f, out_path):
    buf = io.BytesIO()

    frame = Frame(
        ML,              # x
        BODY_BOT,        # y from bottom
        CW,              # width
        PAGE_HEIGHT - BODY_TOP - BODY_BOT,  # height
        leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
    )

    doc = BaseDocTemplate(
        buf, pagesize=A4,
        leftMargin=ML, rightMargin=MR,
        topMargin=BODY_TOP, bottomMargin=BODY_BOT,
    )
    doc.addPageTemplates([
        PageTemplate(id='main', frames=[frame], onPage=draw_page_background)
    ])

    story = build_story(f)
    doc.build(story)

    buf.seek(0)
    with open(out_path, 'wb') as fp:
        fp.write(buf.read())

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: generate_appointment.py <fields.json>', file=sys.stderr)
        sys.exit(1)
    with open(sys.argv[1]) as fp:
        fields = json.load(fp)
    out = fields.get('outputPath', '/tmp/appointment.pdf')
    generate(fields, out)
    print(f'OK: {out}')
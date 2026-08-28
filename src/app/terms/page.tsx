import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — WeBind",
  description: "Terms governing access to and use of WeBind.",
  // Pre-launch: keep the whole site out of search indexes (see root layout).
  robots: { index: false, follow: false, nocache: true },
};

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-8 font-display text-lg font-semibold text-ink">
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[15px] leading-relaxed text-muted">{children}</p>;
}

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-14">
      <Link
        href="/"
        className="font-mono text-xs uppercase tracking-[0.16em] text-muted hover:text-accent"
      >
        ← WeBind
      </Link>

      <div className="mt-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
          Terms of Service
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
          Terms of Service
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          Effective August 28, 2026. These Terms of Service govern your access
          to and use of WeBind, including our websites, reports, dashboards,
          software, AI-assisted features, integrations, publishing tools, and
          related services.
        </p>
      </div>

      <H2>1. Agreement to these terms</H2>
      <P>
        By accessing or using WeBind, creating an account, running a report,
        connecting an integration, purchasing or using a paid feature, or
        otherwise using any part of the service, you agree to these Terms of
        Service and our Privacy Policy. If you do not agree, do not use
        WeBind. If you use WeBind on behalf of a company or other organization,
        you represent that you have authority to bind that organization, and
        “you” includes that organization.
      </P>

      <H2>2. Eligibility and accounts</H2>
      <P>
        You must be legally capable of entering into a binding contract and
        must use WeBind only in compliance with applicable law. You are
        responsible for the accuracy of information associated with your
        account, for maintaining the confidentiality of your credentials, and
        for all activity occurring through your account. You must promptly
        notify us if you believe your account or credentials have been
        compromised.
      </P>

      <H2>3. What WeBind provides</H2>
      <P>
        WeBind provides website analysis, AI Readiness and Traditional
        Authority scoring, recommendations, keyword visibility testing,
        AI-assisted content generation, optimization tools, and integrations
        that may create drafts, publish content, or open pull requests at your
        direction. The free report is a heuristic assessment of page structure,
        evidence, and trust signals. It is not a live guarantee that any search
        engine or AI system will rank, cite, recommend, or surface you. See{" "}
        <Link href="/methodology" className="text-accent hover:underline">
          Methodology
        </Link>{" "}
        for additional detail.
      </P>

      <H2>4. No professional advice or guaranteed outcome</H2>
      <P>
        WeBind provides informational and software services only. Scores,
        recommendations, generated content, visibility results, forecasts,
        explanations, and other outputs are not legal, financial, tax,
        accounting, medical, security, regulatory, or other professional
        advice. They may be incomplete, inaccurate, outdated, or unsuitable
        for your circumstances. You are solely responsible for independently
        reviewing and validating outputs and for deciding whether and how to
        act on them. We do not guarantee traffic, revenue, rankings, citations,
        conversions, visibility, business results, regulatory compliance, or
        any other outcome.
      </P>

      <H2>5. Your websites, content, and permissions</H2>
      <P>
        You may submit or connect only websites, repositories, accounts,
        systems, data, and content that you own or are authorized to access,
        analyze, modify, or publish to. You retain ownership of content and
        materials you provide to WeBind. You grant WeBind a limited,
        non-exclusive license to host, copy, process, transmit, analyze, and
        otherwise use those materials only as reasonably necessary to provide,
        secure, maintain, and improve the service and to perform actions you
        request.
      </P>

      <H2>6. Publishing and integrations</H2>
      <P>
        Integrations with WordPress, GitHub, AI providers, email providers,
        hosting providers, and other third parties are provided for your
        convenience and may be subject to separate third-party terms. When you
        instruct WeBind to create, modify, submit, publish, or otherwise send
        content to a third-party system, you authorize WeBind to take that
        action using the credentials and permissions you supplied. You are
        solely responsible for reviewing content, changes, permissions, and
        destinations before approving or publishing them and for the
        consequences of any action taken through an integration.
      </P>

      <H2>7. Acceptable use</H2>
      <P>
        You may not use WeBind to violate law or third-party rights, gain
        unauthorized access, interfere with or overload systems, circumvent
        security or access controls, probe private or internal networks,
        distribute malware, deceive or impersonate others, scrape or enumerate
        third-party properties at abusive scale, infringe intellectual
        property or privacy rights, or use the service in a way that could
        damage WeBind or another person. We may investigate suspected abuse
        and may restrict or suspend access when reasonably necessary to protect
        the service, users, third parties, or our legal rights.
      </P>

      <H2>8. Usage limits, plans, and changes</H2>
      <P>
        Reports, visibility checks, generation, publishing, integrations, and
        other features may be subject to rate limits, quotas, plan limits, fair
        use limits, technical limits, or other restrictions. We may add,
        remove, modify, suspend, or discontinue features or limits at any time.
        “Unlimited” usage, if offered, remains subject to reasonable fair use,
        abuse prevention, infrastructure capacity, and protection of the
        service.
      </P>

      <H2>9. Fees and payments</H2>
      <P>
        If you purchase a paid plan or feature, you agree to pay all disclosed
        fees and applicable taxes. Unless otherwise stated at purchase, fees
        are non-refundable except where required by law. We may change pricing
        prospectively. If recurring billing is offered, you authorize the
        applicable payment provider to charge the payment method you provide
        at the disclosed interval until cancellation takes effect.
      </P>

      <H2>10. WeBind intellectual property</H2>
      <P>
        WeBind and its licensors retain all rights in the service, including
        its software, design, branding, scoring systems, methodologies,
        documentation, interfaces, and other materials, except for content
        owned by you or third parties. These Terms grant you only a limited,
        revocable, non-exclusive, non-transferable right to use the service in
        accordance with these Terms. No rights are granted by implication.
      </P>

      <H2>11. Feedback</H2>
      <P>
        If you provide suggestions, ideas, or feedback about WeBind, you grant
        us a perpetual, irrevocable, worldwide, royalty-free right to use and
        incorporate that feedback without restriction or obligation to you.
      </P>

      <H2>12. Privacy and security</H2>
      <P>
        Our Privacy Policy explains how WeBind handles personal information.
        We use safeguards intended to protect the service and stored
        credentials, but no system is completely secure. You acknowledge the
        inherent risks of transmitting and storing information online and of
        granting third-party integration credentials.
      </P>

      <H2>13. Third-party services and AI systems</H2>
      <P>
        WeBind may depend on or interact with third-party services, websites,
        APIs, hosting providers, content management systems, repositories, and
        AI models. We do not control those third parties and are not responsible
        for their availability, security, accuracy, outputs, retention
        practices, policy changes, actions, omissions, or terms. Third-party
        services may change or stop functioning with WeBind without notice.
      </P>

      <H2>14. Disclaimer of warranties</H2>
      <P>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, WEBIND AND THE SERVICE ARE
        PROVIDED “AS IS” AND “AS AVAILABLE,” WITH ALL FAULTS AND WITHOUT
        WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, STATUTORY, OR
        OTHERWISE. TO THE MAXIMUM EXTENT PERMITTED BY LAW, WEBIND DISCLAIMS ALL
        WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
        TITLE, NON-INFRINGEMENT, ACCURACY, RELIABILITY, QUIET ENJOYMENT,
        AVAILABILITY, SECURITY, AND ANY WARRANTIES ARISING FROM COURSE OF
        DEALING OR USAGE OF TRADE. WE DO NOT WARRANT THAT THE SERVICE OR ANY
        OUTPUT WILL BE ERROR-FREE, COMPLETE, ACCURATE, CURRENT, SECURE,
        UNINTERRUPTED, OR SUITABLE FOR YOUR PURPOSES.
      </P>

      <H2>15. Assumption of risk and release</H2>
      <P>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, YOU VOLUNTARILY ASSUME ALL
        RISKS ARISING FROM OR RELATED TO YOUR USE OF WEBIND, YOUR RELIANCE ON
        ANY SCORE, RECOMMENDATION, GENERATED CONTENT, ANALYSIS, OR OTHER OUTPUT,
        AND ANY ACTION YOU OR WEBIND TAKES AT YOUR DIRECTION THROUGH AN
        INTEGRATION. THIS INCLUDES THE RISK OF LOST TRAFFIC, LOST RANKINGS,
        REDUCED VISIBILITY, BUSINESS INTERRUPTION, LOST REVENUE, DATA LOSS,
        REPUTATIONAL HARM, CONTENT ERRORS, WEBSITE OR REPOSITORY CHANGES,
        THIRD-PARTY CLAIMS, SECURITY INCIDENTS, PLATFORM PENALTIES, OR ANY OTHER
        ADVERSE, UNEXPECTED, OR UNDESIRED EFFECT.
      </P>
      <P>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, YOU RELEASE AND HOLD HARMLESS
        WEBIND AND ITS OWNERS, AFFILIATES, OFFICERS, DIRECTORS, EMPLOYEES,
        CONTRACTORS, AGENTS, LICENSORS, AND SERVICE PROVIDERS FROM CLAIMS,
        DEMANDS, DAMAGES, LOSSES, LIABILITIES, COSTS, AND CAUSES OF ACTION
        ARISING OUT OF OR RELATING TO SUCH EFFECTS, INCLUDING EFFECTS THAT ARE
        INDIRECT, UNFORESEEN, OR DIFFERENT FROM WHAT YOU EXPECTED. THIS RELEASE
        DOES NOT APPLY TO LIABILITY THAT CANNOT LAWFULLY BE WAIVED OR LIMITED,
        INCLUDING LIABILITY TO THE EXTENT A WAIVER WOULD BE INVALID UNDER
        APPLICABLE LAW.
      </P>

      <H2>16. Limitation of liability</H2>
      <P>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, WEBIND AND ITS OWNERS,
        AFFILIATES, OFFICERS, DIRECTORS, EMPLOYEES, CONTRACTORS, AGENTS,
        LICENSORS, AND SERVICE PROVIDERS WILL NOT BE LIABLE FOR ANY INDIRECT,
        INCIDENTAL, SPECIAL, EXEMPLARY, PUNITIVE, OR CONSEQUENTIAL DAMAGES, OR
        FOR ANY LOSS OF PROFITS, REVENUE, GOODWILL, DATA, BUSINESS
        OPPORTUNITY, EXPECTED SAVINGS, TRAFFIC, RANKINGS, VISIBILITY, OR USE,
        ARISING OUT OF OR RELATING TO THE SERVICE, EVEN IF ADVISED OF THE
        POSSIBILITY OF SUCH DAMAGES.
      </P>
      <P>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE TOTAL AGGREGATE LIABILITY
        OF WEBIND AND THE FOREGOING PARTIES FOR ALL CLAIMS ARISING OUT OF OR
        RELATING TO THE SERVICE OR THESE TERMS WILL NOT EXCEED THE GREATER OF
        ONE HUNDRED U.S. DOLLARS ($100) OR THE AMOUNT YOU PAID DIRECTLY TO
        WEBIND FOR THE SERVICE DURING THE SIX MONTHS BEFORE THE EVENT GIVING
        RISE TO THE CLAIM. THE LIMITATIONS IN THIS SECTION APPLY REGARDLESS OF
        THE THEORY OF LIABILITY AND EVEN IF A LIMITED REMEDY FAILS OF ITS
        ESSENTIAL PURPOSE. NOTHING IN THESE TERMS EXCLUDES OR LIMITS LIABILITY
        THAT APPLICABLE LAW DOES NOT PERMIT TO BE EXCLUDED OR LIMITED.
      </P>

      <H2>17. Indemnification</H2>
      <P>
        To the maximum extent permitted by law, you will defend, indemnify,
        and hold harmless WeBind and its owners, affiliates, officers,
        directors, employees, contractors, agents, licensors, and service
        providers from and against third-party claims, actions, proceedings,
        damages, judgments, settlements, penalties, losses, liabilities, costs,
        and expenses, including reasonable attorneys’ fees, arising out of or
        relating to your content, websites, repositories, accounts, data, use
        of the service, use of an integration, violation of these Terms,
        violation of law, or infringement or violation of another person’s
        rights. WeBind may control the defense and settlement of any matter
        subject to indemnification, and you agree to reasonably cooperate. We
        will not settle a claim in a manner that imposes a direct admission or
        non-monetary obligation on you without your consent, not to be
        unreasonably withheld.
      </P>

      <H2>18. Suspension and termination</H2>
      <P>
        You may stop using WeBind at any time. We may suspend, restrict, or
        terminate access if you violate these Terms, create legal or security
        risk, fail to pay amounts due, abuse the service, or if continuing to
        provide the service is no longer commercially or technically
        reasonable. Upon termination, rights granted to you under these Terms
        end, but provisions that by their nature should survive will survive,
        including provisions concerning ownership, disclaimers, release,
        limitation of liability, indemnification, disputes, and miscellaneous
        terms.
      </P>

      <H2>19. Governing law</H2>
      <P>
        These Terms and any dispute, claim, or controversy arising out of or
        relating to these Terms or the service are governed by the laws of the
        State of California, without regard to conflict-of-laws principles,
        except to the extent federal law controls.
      </P>

      <H2>20. Exclusive venue and jurisdiction</H2>
      <P>
        To the fullest extent permitted by law, any lawsuit, action, or
        proceeding arising out of or relating to these Terms or the service
        must be brought exclusively in the United States District Court for
        the Eastern District of California, Sacramento Division, if federal
        subject-matter jurisdiction exists, or otherwise in the Superior Court
        of California, County of Sacramento. You and WeBind irrevocably submit
        to the personal jurisdiction of those courts and waive, to the extent
        permitted by law, any objection based on venue, inconvenient forum, or
        lack of personal jurisdiction.
      </P>

      <H2>21. Time limit for claims</H2>
      <P>
        To the maximum extent permitted by law, any claim arising out of or
        relating to the service or these Terms must be filed within one year
        after the claim arose, or it is permanently barred. This section does
        not shorten any limitations period that applicable law prohibits the
        parties from shortening.
      </P>

      <H2>22. Changes to these terms</H2>
      <P>
        We may update these Terms from time to time. Material changes will be
        posted on this page and will become effective on the stated effective
        date. Your continued use of WeBind after revised Terms take effect
        constitutes acceptance of the revised Terms to the extent permitted by
        law. If you do not agree to revised Terms, you must stop using the
        service.
      </P>

      <H2>23. Miscellaneous</H2>
      <P>
        These Terms and any policies expressly incorporated by reference are
        the entire agreement between you and WeBind concerning the service and
        supersede prior or contemporaneous agreements on that subject. If any
        provision is held unenforceable, it will be enforced to the maximum
        extent permitted and the remaining provisions will remain in effect.
        A failure to enforce a provision is not a waiver. You may not assign
        these Terms without our prior written consent. We may assign these
        Terms in connection with a merger, acquisition, reorganization, sale of
        assets, financing, or by operation of law. Headings are for convenience
        only. Nothing in these Terms creates an agency, partnership, joint
        venture, employment, fiduciary, or franchise relationship.
      </P>

      <H2>24. Contact</H2>
      <P>
        Questions about these Terms may be sent to{" "}
        <a href="mailto:info@webind.design" className="text-accent hover:underline">
          info@webind.design
        </a>
        .
      </P>
    </main>
  );
}

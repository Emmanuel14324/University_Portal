import Link from "next/link";

export default function Home() {
  return (
    <main className="welcome">
      <header className="welcome-header">
        <Link className="brand" href="/">
          <span className="brand-mark">N</span>
          <span>St Jude <strong>University</strong></span>
        </Link>
        <Link className="button button-outline" href="/login">Portal sign in <span aria-hidden="true">↗</span></Link>
      </header>

      <section className="welcome-hero">
        <div className="welcome-copy">
          <span className="eyebrow"><span className="eyebrow-dot" /> STUDENT INFORMATION SYSTEM</span>
          <h1>Your university life,<br /><em>all in one place.</em></h1>
          <p>Welcome to St Jude University&apos;s student portal. Manage your courses, track your results, and stay connected to campus life in Uganda.</p>
          <div className="welcome-actions">
            <Link className="button button-primary" href="/login">Enter the portal <span aria-hidden="true">→</span></Link>
            <Link className="text-link" href="/student/dashboard">Explore student view <span aria-hidden="true">↗</span></Link>
          </div>
          <div className="welcome-footnote"><span className="mini-avatar">NU</span><span>One connected campus<br /><strong>Built around your next step</strong></span></div>
        </div>
        <div className="welcome-art" aria-label="Illustration of the student portal dashboard">
          <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
          <div className="art-window">
            <div className="art-window-top"><span /><span /><span /><b>MY CAMPUS</b></div>
            <div className="art-window-body">
              <div className="art-menu"><i /><i /><i /><i /><i /></div>
              <div className="art-dashboard">
                <small>MONDAY, OCTOBER 19</small><h3>Good morning, Alex</h3><span className="art-pill">Fall semester 2025</span>
                <div className="art-stats"><div><small>GPA</small><b>3.82</b><span>↑ 0.14 this term</span></div><div><small>COURSES</small><b>5</b><span>15 credits</span></div></div>
                <div className="art-course"><span className="course-block block-violet">CS</span><span><b>Data Structures</b><small>CS 240 · Room 3.14</small></span><i>10:30</i></div>
                <div className="art-course"><span className="course-block block-gold">MA</span><span><b>Linear Algebra</b><small>MATH 221 · Room 2.08</small></span><i>13:00</i></div>
                <div className="art-progress"><span>Semester progress</span><b>68%</b><i><span /></i></div>
              </div>
            </div>
          </div>
          <div className="floating-note"><span className="note-icon">✓</span><span><small>ENROLLMENT OPEN</small><b>Spring registration</b></span><strong>→</strong></div>
          <div className="art-sparkle sparkle-one">✳</div><div className="art-sparkle sparkle-two">✳</div>
        </div>
      </section>
      <footer className="welcome-footer"><span>© 2025 St Jude University</span><span>Student success starts here.</span><span>Portal preview · Sample data</span></footer>
    </main>
  );
}

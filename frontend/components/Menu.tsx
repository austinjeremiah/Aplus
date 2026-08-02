export default function Menu() {
  return (
    <div className="menu_wrap">
      <div className="menu_contain">
        <ul className="menu_contain_nav u-gap-small u-hflex-left-center">
          <li data-wf--footer-link--variant="base" className="footer_nav_li">
            <button id="" data-open-modal="" data-hover-highlight="link" className="footer_nav_text">
              <div data-hover-heading="" className="footer_nav_span u-text-style-h3">
                About
              </div>
              <div data-footer-arrow="" className="footer_nav_span u-text-style-h3 is-arrow">
                →
              </div>
            </button>
          </li>
          <li data-wf--footer-link--variant="base" className="footer_nav_li">
            <a href="#work" data-hover-highlight="link" className="footer_nav_text w-inline-block">
              <div data-hover-heading="" className="footer_nav_span u-text-style-h3">
                Work
              </div>
              <div data-footer-arrow="" className="footer_nav_span u-text-style-h3 is-arrow">
                →
              </div>
            </a>
          </li>
          <li data-wf--footer-link--variant="base" className="footer_nav_li">
            <a href="#process" data-hover-highlight="link" className="footer_nav_text w-inline-block">
              <div data-hover-heading="" className="footer_nav_span u-text-style-h3">
                Process
              </div>
              <div data-footer-arrow="" className="footer_nav_span u-text-style-h3 is-arrow">
                →
              </div>
            </a>
          </li>
          <li data-wf--footer-link--variant="base" className="footer_nav_li">
            <a href="#services" data-hover-highlight="link" className="footer_nav_text w-inline-block">
              <div data-hover-heading="" className="footer_nav_span u-text-style-h3">
                Services
              </div>
              <div data-footer-arrow="" className="footer_nav_span u-text-style-h3 is-arrow">
                →
              </div>
            </a>
          </li>
          <li data-wf--footer-link--variant="base" className="footer_nav_li">
            <a href="https://cal.com/byhuy/project-intro-call" data-hover-highlight="link" target="_blank" className="footer_nav_text w-inline-block">
              <div data-hover-heading="" className="footer_nav_span u-text-style-h3">
                Contact
              </div>
              <div data-footer-arrow="" className="footer_nav_span u-text-style-h3 is-arrow">
                →
              </div>
            </a>
          </li>
        </ul>
      </div>
      <div className="menu_popup_collection w-dyn-list">
        <div role="list" className="menu_popup_list w-dyn-items">
          <div role="listitem" className="menu_popup_item w-dyn-item">
            <a href="#" className="menu_popup_link w-inline-block">
              <div className="menu_popup_cover">
                <img loading="lazy" src="/assets/697db3aecf1ddb096d2ec598_linkedin_profilepics_2.avif" alt="" sizes="100vw" srcSet="/assets/697db3aecf1ddb096d2ec598_LinkedIn_ProfilePics_2-p-500.avif 500w, /assets/697db3aecf1ddb096d2ec598_LinkedIn_ProfilePics_2.avif 1000w" className="menu_popup_image" />
              </div>
              <div className="menu_popup_content">
                <p className="menu_popup_p u-text-style-small">
                  Supersolid onboards FujiFilm Australia and Hyatt Hotels as clients
                </p>
                <span className="menu_popup_date u-text-mono">
                  January 20, 2026
                </span>
              </div>
            </a>
            <svg width="100%" viewBox="0 0 12 12" fill="none" className="g_btn_svg" xmlns="http://www.w3.org/2000/svg">
              <path d="M8.90954 9.09046L9 3L2.90954 3.09046L2.90213 4.32367L6.86437 4.25391L2.55914 8.55914L3.44086 9.44086L7.74609 5.13563L7.68708 9.10862L8.90954 9.09046Z" fill="currentColor" />
            </svg>
          </div>
        </div>
      </div>
      <button data-close-modal="" id="" className="menu_overlay_close" />
    </div>
  );
}

export default ({
  user,
  fields,
  bioHtml
}) => `
    <!doctype html>
    <html>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <!--made by @padolsey // j11y.io-->
    <head><title>${user}.at.hn</title></head>
    <style>
      html, body {
        margin: 0;
        padding: 0;
      }
      body {
        padding: 1em;
        font-size: 10pt;
        font-family: Verdana, Geneva, sans-serif;
      }
      * {
        box-sizing: border-box;
      }
      #c {
        background: #f6f6ef;
        width: 80%;
        margin: 0 auto;
        padding: 1em;
      }
      header h1 {
        margin: 0;
        padding: 0 0 .3em;
      }
      header h1 a {
        color: inherit;
        text-decoration: none;
      }
      header p {
        margin: 0;
        padding: 0;
      }
      header span {
        color: #828282;
      }
      img {
        max-width: 400px;
        max-height: 400px;
        width: 100%;
      }
      @media only screen and (max-width: 750px) {
        #c {
          width: 100%;
        }
      }
    </style>
    <body>
      <div id="c">
        <header>
          <h1><a href="https://${user}.at.hn">${user}<span>.at.hn</span></a></h1>
          <p>
            <small>
              <span>karma:</span> ${fields.karma}
            </small>
            |
            <small>
              <span><a href="https://news.ycombinator.com/user?id=${user}">profile</a></span>
            </small>
            |
            <small>
              <span><a href="https://news.ycombinator.com/submitted?id=${user}">submissions</a></span>
            </small>
            |
            <small>
              <span><a href="https://news.ycombinator.com/threads?id=${user}">comments</a></span>
            </small>
          </p>
        </header>
        <div>${bioHtml}</div>
        <footer>
          <center><small><a href="https://at.hn/">at.hn info</a> | <a href="/?refresh">queue refresh</a></small></center>
        </footer>
      </div>
    </body>
    </html>
`;
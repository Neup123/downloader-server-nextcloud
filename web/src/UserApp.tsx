/** Legacy ExApp HTML is not a supported UI. The signed /user/ route
 * redirects to the native Nextcloud Library; do not revive parallel controls.
 */
export default function UserApp() {
  return <main className="user-downloader">
    <p>Downloader is available in Nextcloud Library and Personal settings.</p>
  </main>;
}

package tw.hangukgwan.kiosk;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.UnsupportedEncodingException;
import java.net.ConnectException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Sends raw ESC/POS bytes straight to the kitchen printer over TCP.
 *
 * The printer (DaiDai/XinYe XP-N160II, USB+LAN version) is plugged into the
 * restaurant's router with a LAN cable and speaks the standard AppSocket /
 * JetDirect protocol on port 9100: whatever bytes you write to that socket get
 * printed verbatim. So there is nothing to negotiate here - open the socket,
 * write the bytes the web page already built, close it.
 *
 * This is what lets the tablet print with no tap at all. A web page in Chrome
 * cannot open a TCP socket, and cannot hand a print job to another app without
 * a real user gesture (Chrome blocks "a JavaScript timer tried to open an
 * application without a user gesture"), which is why the new-order auto print
 * never fired on its own there while the manual button worked. Inside this app
 * the same job is just a socket write, with no browser policy in the way - and
 * no RawBT app in the middle either, so nothing re-interprets our bytes through
 * a wrong code page on the way to the paper.
 *
 * All jobs run on ONE background thread. Two orders landing in the same
 * 4-second poll would otherwise open two sockets at once, and this printer has
 * a single input buffer - the two tickets would interleave into garbage.
 * Queuing them costs nothing (a ticket takes well under a second) and keeps
 * every ticket whole.
 */
public class PrinterClient {

    public interface Callback {
        void onResult(boolean ok, String message);
    }

    private static final ExecutorService QUEUE = Executors.newSingleThreadExecutor();

    private static final int CONNECT_TIMEOUT_MS = 5000;
    private static final int WRITE_TIMEOUT_MS = 10000;

    /** Queues a print job. Returns immediately; the callback runs on the queue thread. */
    public static void printAsync(final String host, final int port, final byte[] data, final Callback cb) {
        QUEUE.submit(new Runnable() {
            @Override
            public void run() {
                String err = printBlocking(host, port, data);
                if (cb != null) {
                    cb.onResult(err == null, err == null ? "printed" : err);
                }
            }
        });
    }

    /** Returns null on success, or a human-readable (Korean) error message. */
    public static String printBlocking(String host, int port, byte[] data) {
        if (host == null || host.trim().length() == 0) {
            return "프린터 IP가 설정되지 않았습니다";
        }
        Socket socket = null;
        try {
            socket = new Socket();
            socket.connect(new InetSocketAddress(host.trim(), port), CONNECT_TIMEOUT_MS);
            socket.setSoTimeout(WRITE_TIMEOUT_MS);
            // Nagle's algorithm would sit on the small trailing chunk (the cut
            // command) waiting for more data; turn it off so the whole ticket
            // reaches the printer as soon as it is written.
            socket.setTcpNoDelay(true);
            OutputStream out = socket.getOutputStream();
            out.write(data);
            out.flush();
            // Closing the socket the instant flush() returns can cut the last
            // packet short on these cheap print servers - they acknowledge the
            // TCP write before the print head has consumed it. A short pause
            // before close is the usual remedy and costs nothing here.
            try {
                Thread.sleep(300);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            return null;
        } catch (SocketTimeoutException e) {
            return "프린터 응답 없음 (" + host + ":" + port + ")";
        } catch (ConnectException e) {
            return "프린터에 연결할 수 없습니다 (" + host + ":" + port + ")";
        } catch (UnknownHostException e) {
            return "프린터 주소를 찾을 수 없습니다: " + host;
        } catch (Exception e) {
            return "인쇄 실패: " + e.getClass().getSimpleName() + " " + String.valueOf(e.getMessage());
        } finally {
            if (socket != null) {
                try {
                    socket.close();
                } catch (Exception ignored) {
                    // nothing useful to do if close fails
                }
            }
        }
    }

    /**
     * A small self-test ticket for the settings screen, so the printer wiring
     * can be verified without waiting for a real order. Deliberately
     * ASCII-only: this printer's firmware reads non-ASCII text through its own
     * built-in code page (exactly why real tickets are sent as a bitmap
     * instead), so a test ticket with Korean or Chinese in it would come out
     * garbled and look like a failure when the connection is actually fine.
     */
    public static byte[] testTicket() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            out.write(new byte[] { 0x1B, 0x40 });             // ESC @      initialize
            out.write(new byte[] { 0x1B, 0x61, 0x01 });       // ESC a 1    center
            out.write(new byte[] { 0x1B, 0x21, 0x30 });       // ESC ! 0x30 double height + width
            out.write(ascii("HANGUKGWAN\n"));
            out.write(new byte[] { 0x1B, 0x21, 0x00 });       // ESC ! 0    normal
            out.write(ascii("Printer Test OK\n"));
            out.write(new byte[] { 0x1B, 0x61, 0x00 });       // ESC a 0    left
            out.write(ascii("--------------------------------\n"));
            out.write(ascii("Connection : TCP port 9100\n"));
            out.write(ascii("App        : Hangukgwan POS\n"));
            out.write(ascii("--------------------------------\n"));
            out.write(ascii("\n\n\n"));
            out.write(new byte[] { 0x1D, 0x56, 0x42, 0x00 }); // GS V B 0   feed and cut
        } catch (IOException ignored) {
            // ByteArrayOutputStream never actually throws
        }
        return out.toByteArray();
    }

    private static byte[] ascii(String s) {
        try {
            return s.getBytes("US-ASCII");
        } catch (UnsupportedEncodingException e) {
            return s.getBytes();
        }
    }
}

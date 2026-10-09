package com.cinemuah.app;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The offline library: video files in Movies/Cinemuah (public, visible in the gallery on Android 10+)
 * plus the app's own movies folder on older Android versions.
 */
public final class Library {
    private Library() {}

    public static final String FOLDER = "Cinemuah";

    public static final class Item {
        public int id;
        public String path;      // display path or content uri string
        public String name;
        public long size;
        public long modified;    // ms
        Uri uri;                 // set for MediaStore items
        File file;               // set for plain files
    }

    private static final ConcurrentHashMap<Integer, Item> BY_ID = new ConcurrentHashMap<>();

    public static Item find(int id) { return BY_ID.get(id); }

    private static int idFor(String key) { return key.hashCode() & 0x7fffffff; }

    private static boolean isVideo(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        return n.endsWith(".mp4") || n.endsWith(".mkv") || n.endsWith(".webm") || n.endsWith(".m4v")
                || n.endsWith(".mov") || n.endsWith(".avi");
    }

    public static File appMoviesDir(Context ctx) {
        File dir = ctx.getExternalFilesDir(Environment.DIRECTORY_MOVIES);
        if (dir == null) dir = new File(ctx.getFilesDir(), "Movies");
        File out = new File(dir, FOLDER);
        //noinspection ResultOfMethodCallIgnored
        out.mkdirs();
        return out;
    }

    public static List<Item> list(Context ctx) {
        List<Item> items = new ArrayList<>();
        BY_ID.clear();

        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = ctx.getContentResolver();
            String[] proj = {MediaStore.Video.Media._ID, MediaStore.Video.Media.DISPLAY_NAME,
                    MediaStore.Video.Media.SIZE, MediaStore.Video.Media.DATE_MODIFIED,
                    MediaStore.Video.Media.RELATIVE_PATH};
            try (Cursor c = cr.query(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, proj,
                    MediaStore.Video.Media.RELATIVE_PATH + " LIKE ?",
                    new String[]{Environment.DIRECTORY_MOVIES + "/" + FOLDER + "%"}, null)) {
                while (c != null && c.moveToNext()) {
                    Item it = new Item();
                    long mid = c.getLong(0);
                    it.uri = ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, mid);
                    it.name = c.getString(1);
                    it.size = c.getLong(2);
                    it.modified = c.getLong(3) * 1000L;
                    it.path = c.getString(4) + it.name;
                    it.id = idFor(it.uri.toString());
                    items.add(it);
                }
            } catch (Exception ignored) {
                // no access: fall through to app folder only
            }
        }

        walk(appMoviesDir(ctx), items);
        for (Item it : items) BY_ID.put(it.id, it);
        return items;
    }

    private static void walk(File dir, List<Item> out) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (f.isDirectory()) { walk(f, out); continue; }
            if (!isVideo(f.getName())) continue;
            Item it = new Item();
            it.file = f;
            it.name = f.getName();
            it.size = f.length();
            it.modified = f.lastModified();
            it.path = f.getAbsolutePath();
            it.id = idFor(f.getAbsolutePath());
            out.add(it);
        }
    }

    public static boolean delete(Context ctx, int id) {
        Item it = BY_ID.get(id);
        if (it == null) return false;
        try {
            if (it.uri != null) return ctx.getContentResolver().delete(it.uri, null, null) > 0;
            return it.file != null && it.file.delete();
        } catch (Exception e) {
            return false;
        }
    }

    /** Opens a read stream positioned at `start`, limited by the caller. */
    public static InputStream open(Context ctx, Item it, long start) throws IOException {
        if (it.uri != null) {
            final ParcelFileDescriptor pfd = ctx.getContentResolver().openFileDescriptor(it.uri, "r");
            if (pfd == null) throw new IOException("Cannot open " + it.name);
            final FileInputStream fis = new FileInputStream(pfd.getFileDescriptor());
            fis.getChannel().position(start);
            return new InputStream() {
                @Override public int read() throws IOException { return fis.read(); }
                @Override public int read(byte[] b, int off, int len) throws IOException { return fis.read(b, off, len); }
                @Override public void close() throws IOException { try { fis.close(); } finally { pfd.close(); } }
            };
        }
        FileInputStream fis = new FileInputStream(it.file);
        //noinspection ResultOfMethodCallIgnored
        fis.skip(start);
        return fis;
    }

    /**
     * Moves a finished download into the library. Returns the final location (for display).
     * subPath is e.g. "Show/Season 01" or "Movie (2020)".
     */
    public static String publish(Context ctx, File source, String subPath, String fileName) throws IOException {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = ctx.getContentResolver();
            // Downloading something that is already in the library replaces it instead of creating "Name (1).mp4"
            String rel = Environment.DIRECTORY_MOVIES + "/" + FOLDER + "/" + subPath + "/";
            try {
                cr.delete(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                        MediaStore.Video.Media.DISPLAY_NAME + "=? AND " + MediaStore.Video.Media.RELATIVE_PATH + "=?",
                        new String[]{fileName, rel});
            } catch (Exception ignored) { /* nothing to replace, or not ours to delete */ }
            ContentValues v = new ContentValues();
            v.put(MediaStore.Video.Media.DISPLAY_NAME, fileName);
            v.put(MediaStore.Video.Media.MIME_TYPE, mime(fileName));
            v.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/" + FOLDER + "/" + subPath);
            v.put(MediaStore.Video.Media.IS_PENDING, 1);
            Uri uri = cr.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IOException("Could not create the file in Movies");
            try (InputStream in = new FileInputStream(source); OutputStream out = cr.openOutputStream(uri)) {
                if (out == null) throw new IOException("Could not write to Movies");
                byte[] buf = new byte[256 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Video.Media.IS_PENDING, 0);
            cr.update(uri, done, null, null);
            //noinspection ResultOfMethodCallIgnored
            source.delete();
            return Environment.DIRECTORY_MOVIES + "/" + FOLDER + "/" + subPath + "/" + fileName;
        }

        File dir = new File(appMoviesDir(ctx), subPath);
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File dest = new File(dir, fileName);
        if (!source.renameTo(dest)) {
            try (InputStream in = new FileInputStream(source); OutputStream out = new FileOutputStream(dest)) {
                byte[] buf = new byte[256 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            //noinspection ResultOfMethodCallIgnored
            source.delete();
        }
        return dest.getAbsolutePath();
    }

    public static String mime(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".mkv")) return "video/x-matroska";
        if (n.endsWith(".webm")) return "video/webm";
        if (n.endsWith(".avi")) return "video/x-msvideo";
        if (n.endsWith(".mov")) return "video/quicktime";
        return "video/mp4";
    }
}

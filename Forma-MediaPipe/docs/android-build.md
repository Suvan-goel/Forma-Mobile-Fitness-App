# Android build setup (Java 17)

This project requires **Java 17** (or 21) for Android builds. Gradle 8.x does **not** support Java 25. If you see:

```
Unsupported class file major version 69
```

you are running Gradle with Java 25. Use Java 17 to run the build.

## Option A: Use the Java-17 build script (easiest on macOS)

From the project root:

```bash
cd android
chmod +x build-with-java17.sh
./build-with-java17.sh assembleRelease
cd ..
```

The script uses `/usr/libexec/java_home -v 17` (or 21) on macOS so Gradle runs with a compatible JDK.

## Option B: User-level Gradle config

Add this to your local `~/.gradle/gradle.properties`:

```
org.gradle.java.home=/path/to/your/jdk-17
```

- **macOS:** `$(/usr/libexec/java_home -v 17)` or `/Library/Java/JavaVirtualMachines/jdk-17.*/Contents/Home`
- **Linux:** e.g. `/usr/lib/jvm/java-17-openjdk-amd64`

## Option C: Set JAVA_HOME before running

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)   # macOS
cd android && ./gradlew assembleRelease && cd ..
```

## Option D: jenv + .java-version

If you use `jenv`, set Java 17 for this repo:

```
jenv local 17
```

## Verify

```
java -version
cd android && ./gradlew -version
```

# Android build setup (Java 17)

This project requires Java 17 for Android builds. Avoid hardcoding `org.gradle.java.home`
in the repo; configure it locally instead.

## Option A: User-level Gradle config (recommended)

Add this to your local `~/.gradle/gradle.properties`:

```
org.gradle.java.home=/path/to/your/jdk-17
```

## Option B: jenv + .java-version

If you use `jenv`, set Java 17 for this repo:

```
jenv local 17
```

You can also commit a `.java-version` file with `17` to make this explicit.

## Verify

```
java -version
./gradlew -version
```

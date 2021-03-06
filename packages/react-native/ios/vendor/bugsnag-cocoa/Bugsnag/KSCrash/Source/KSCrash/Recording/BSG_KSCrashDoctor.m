//
//  BSG_KSCrashDoctor.m
//  BSG_KSCrash
//
//  Created by Karl Stenerud on 2012-11-10.
//  Copyright (c) 2012 Karl Stenerud. All rights reserved.
//

#import "BSG_KSCrashDoctor.h"
#import "BSG_KSCrashReportFields.h"
#import "BSG_KSSystemInfo.h"

#define BSG_kUserCrashHandler "kscrw_i_callUserCrashHandler"

typedef NS_ENUM(NSUInteger, BSG_CPUFamily) {
    BSG_CPUFamilyUnknown,
    BSG_CPUFamilyArm,
    BSG_CPUFamilyArm64,
    BSG_CPUFamilyX86,
    BSG_CPUFamilyX86_64
};

@interface BSG_KSCrashDoctorParam : NSObject

@property(nonatomic, readwrite, retain) NSString *className;
@property(nonatomic, readwrite, retain) NSString *previousClassName;
@property(nonatomic, readwrite, retain) NSString *type;
@property(nonatomic, readwrite, assign) BOOL isInstance;
@property(nonatomic, readwrite, assign) uintptr_t address;
@property(nonatomic, readwrite, retain) NSString *value;

@end

@implementation BSG_KSCrashDoctorParam

@synthesize className = _className;
@synthesize previousClassName = _previousClassName;
@synthesize isInstance = _isInstance;
@synthesize address = _address;
@synthesize value = _value;
@synthesize type = _type;

@end

@interface BSG_KSCrashDoctorFunctionCall : NSObject

@property(nonatomic, readwrite, retain) NSString *name;
@property(nonatomic, readwrite, retain) NSArray *params;

@end

@implementation BSG_KSCrashDoctorFunctionCall

@synthesize name = _name;
@synthesize params = _params;

@end

@implementation BSG_KSCrashDoctor

+ (BSG_KSCrashDoctor *)doctor {
    return [[self alloc] init];
}

- (NSDictionary *)recrashReport:(NSDictionary *)report {
    return report[@BSG_KSCrashField_RecrashReport];
}

- (NSDictionary *)systemReport:(NSDictionary *)report {
    return report[@BSG_KSCrashField_System];
}

- (NSDictionary *)crashReport:(NSDictionary *)report {
    return report[@BSG_KSCrashField_Crash];
}

- (NSDictionary *)infoReport:(NSDictionary *)report {
    return report[@BSG_KSCrashField_Report];
}

- (NSDictionary *)errorReport:(NSDictionary *)report {
    return [self crashReport:report][@BSG_KSCrashField_Error];
}

- (BSG_CPUFamily)cpuFamily:(NSDictionary *)report {
    NSDictionary *system = [self systemReport:report];
    NSString *cpuArch = system[@BSG_KSSystemField_CPUArch];
    if ([cpuArch isEqualToString:@"arm64"]) {
        return BSG_CPUFamilyArm64;
    }
    if ([cpuArch rangeOfString:@"arm"].location == 0) {
        return BSG_CPUFamilyArm;
    }
    if ([cpuArch rangeOfString:@"i"].location == 0 &&
        [cpuArch rangeOfString:@"86"].location == 2) {
        return BSG_CPUFamilyX86;
    }
    if ([@[@"x86_64", @"x86"] containsObject:cpuArch]) {
        return BSG_CPUFamilyX86_64;
    }
    return BSG_CPUFamilyUnknown;
}

- (NSString *)registerNameForFamily:(BSG_CPUFamily)family
                         paramIndex:(int)index {
    switch (family) {
    case BSG_CPUFamilyArm: {
        switch (index) {
        case 0:
            return @"r0";
        case 1:
            return @"r1";
        case 2:
            return @"r2";
        case 3:
            return @"r3";
        }
    }
    case BSG_CPUFamilyArm64: {
        switch (index) {
            case 0:
                return @"x0";
            case 1:
                return @"x1";
            case 2:
                return @"x2";
            case 3:
                return @"x3";
        }
    }
    case BSG_CPUFamilyX86: {
        switch (index) {
        case 0:
            return @"edi";
        case 1:
            return @"esi";
        case 2:
            return @"edx";
        case 3:
            return @"ecx";
        }
    }
    case BSG_CPUFamilyX86_64: {
        switch (index) {
        case 0:
            return @"rdi";
        case 1:
            return @"rsi";
        case 2:
            return @"rdx";
        case 3:
            return @"rcx";
        }
    }
    case BSG_CPUFamilyUnknown:
        return nil;
    }
    return nil;
}

- (NSString *)mainExecutableNameForReport:(NSDictionary *)report {
    NSDictionary *info = [self infoReport:report];
    return info[@BSG_KSCrashField_ProcessName];
}

- (NSDictionary *)crashedThreadReport:(NSDictionary *)report {
    NSDictionary *crashReport = [self crashReport:report];
    NSDictionary *crashedThread =
            crashReport[@BSG_KSCrashField_CrashedThread];
    if (crashedThread != nil) {
        return crashedThread;
    }

    for (NSDictionary *thread in
            crashReport[@BSG_KSCrashField_Threads]) {
        if ([thread[@BSG_KSCrashField_Crashed] boolValue]) {
            return thread;
        }
    }
    return nil;
}

- (NSArray *)backtraceFromThreadReport:(NSDictionary *)threadReport {
    NSDictionary *backtrace =
            threadReport[@BSG_KSCrashField_Backtrace];
    return backtrace[@BSG_KSCrashField_Contents];
}

- (NSDictionary *)basicRegistersFromThreadReport:(NSDictionary *)threadReport {
    NSDictionary *registers =
            threadReport[@BSG_KSCrashField_Registers];
    NSDictionary *basic = registers[@BSG_KSCrashField_Basic];
    return basic;
}

- (NSDictionary *)lastInAppStackEntry:(NSDictionary *)report {
    NSString *executableName = [self mainExecutableNameForReport:report];
    NSDictionary *crashedThread = [self crashedThreadReport:report];
    NSArray *backtrace = [self backtraceFromThreadReport:crashedThread];
    for (NSDictionary *entry in backtrace) {
        NSString *objectName =
                entry[@BSG_KSCrashField_ObjectName];
        if ([objectName isEqualToString:executableName]) {
            return entry;
        }
    }
    return nil;
}

- (NSDictionary *)lastStackEntry:(NSDictionary *)report {
    NSDictionary *crashedThread = [self crashedThreadReport:report];
    NSArray *backtrace = [self backtraceFromThreadReport:crashedThread];
    if ([backtrace count] > 0) {
        return backtrace[0];
    }
    return nil;
}

- (BOOL)isInvalidAddress:(NSDictionary *)errorReport {
    NSDictionary *machError = errorReport[@BSG_KSCrashField_Mach];
    if (machError != nil) {
        NSString *exceptionName =
                machError[@BSG_KSCrashField_ExceptionName];
        return [exceptionName isEqualToString:@"EXC_BAD_ACCESS"];
    }
    NSDictionary *signal = errorReport[@BSG_KSCrashField_Signal];
    NSString *sigName = signal[@BSG_KSCrashField_Name];
    return [sigName isEqualToString:@"SIGSEGV"];
}

- (BOOL)isMathError:(NSDictionary *)errorReport {
    NSDictionary *machError = errorReport[@BSG_KSCrashField_Mach];
    if (machError != nil) {
        NSString *exceptionName =
                machError[@BSG_KSCrashField_ExceptionName];
        return [exceptionName isEqualToString:@"EXC_ARITHMETIC"];
    }
    NSDictionary *signal = errorReport[@BSG_KSCrashField_Signal];
    NSString *sigName = signal[@BSG_KSCrashField_Name];
    return [sigName isEqualToString:@"SIGFPE"];
}

- (BOOL)isMemoryCorruption:(NSDictionary *)report {
    NSDictionary *crashedThread = [self crashedThreadReport:report];
    NSArray *notableAddresses =
            crashedThread[@BSG_KSCrashField_NotableAddresses];
    for (NSDictionary *address in [notableAddresses objectEnumerator]) {
        NSString *type = address[@BSG_KSCrashField_Type];
        if ([type isEqualToString:@"string"]) {
            NSString *value = address[@BSG_KSCrashField_Value];
            if ([value rangeOfString:@"autorelease pool page"].location !=
                    NSNotFound &&
                [value rangeOfString:@"corrupted"].location != NSNotFound) {
                return YES;
            }
            if ([value rangeOfString:@"incorrect checksum for freed object"]
                    .location != NSNotFound) {
                return YES;
            }
        }
    }

    NSArray *backtrace = [self backtraceFromThreadReport:crashedThread];
    for (NSDictionary *entry in backtrace) {
        NSString *objectName =
                entry[@BSG_KSCrashField_ObjectName];
        NSString *symbolName =
                entry[@BSG_KSCrashField_SymbolName];
        if ([symbolName isEqualToString:@"objc_autoreleasePoolPush"]) {
            return YES;
        }
        if ([symbolName isEqualToString:@"free_list_checksum_botch"]) {
            return YES;
        }
        if ([symbolName isEqualToString:@"szone_malloc_should_clear"]) {
            return YES;
        }
        if ([symbolName isEqualToString:@"lookUpMethod"] &&
            [objectName isEqualToString:@"libobjc.A.dylib"]) {
            return YES;
        }
    }

    return NO;
}

- (BOOL)isStackOverflow:(NSDictionary *)crashedThreadReport {
    NSDictionary *stack =
            crashedThreadReport[@BSG_KSCrashField_Stack];
    return [stack[@BSG_KSCrashField_Overflow] boolValue];
}

- (NSString *)appendOriginatingCall:(NSString *)string
                           callName:(NSString *)callName {
    if (callName != nil && ![callName isEqualToString:@"main"]) {
        return [string
            stringByAppendingFormat:@"\nOriginated at or in a subcall of %@",
                                    callName];
    }
    return string;
}

- (NSString *)diagnoseCrash:(NSDictionary *)report {
    @try {
        NSString *lastFunctionName = [self lastInAppStackEntry:report][@BSG_KSCrashField_SymbolName];
        NSDictionary *crashedThreadReport = [self crashedThreadReport:report];
        NSDictionary *errorReport = [self errorReport:report];

        if ([self isStackOverflow:crashedThreadReport]) {
            return [NSString
                stringWithFormat:@"Stack overflow in %@", lastFunctionName];
        }

        NSString *crashType = errorReport[@BSG_KSCrashField_Type];
        if ([crashType isEqualToString:@BSG_KSCrashExcType_NSException]) {
            NSDictionary *exception =
                    errorReport[@BSG_KSCrashField_NSException];
            NSString *name = exception[@BSG_KSCrashField_Name];
            NSString *reason =
                    exception[@BSG_KSCrashField_Reason];
            return [self
                appendOriginatingCall:
                    [NSString
                        stringWithFormat:@"Application threw exception %@: %@",
                                         name, reason]
                             callName:lastFunctionName];
        }

        if ([self isMemoryCorruption:report]) {
            return @"Rogue memory write has corrupted memory.";
        }

        if ([self isMathError:errorReport]) {
            return [self
                appendOriginatingCall:
                    [NSString
                        stringWithFormat:
                            @"Math error (usually caused from division by 0)."]
                             callName:lastFunctionName];
        }

        if ([self isInvalidAddress:errorReport]) {
            uintptr_t address = (uintptr_t)[errorReport[@BSG_KSCrashField_Address] unsignedLongLongValue];
            if (address == 0) {
                return [self appendOriginatingCall:
                                 @"Attempted to dereference null pointer."
                                          callName:lastFunctionName];
            }
            return [self
                appendOriginatingCall:
                    [NSString
                        stringWithFormat:
                            @"Attempted to dereference garbage pointer %p.",
                            (void *)address]
                             callName:lastFunctionName];
        }

        return nil;
    } @catch (NSException *e) {
        NSArray *symbols = [e callStackSymbols];
        if (symbols) {
            return
                [NSString stringWithFormat:@"No diagnosis due to exception "
                                           @"%@:\n%@\nPlease file a bug report "
                                           @"to the BSG_KSCrash project.",
                                           e, symbols];
        }
        return [NSString
            stringWithFormat:@"No diagnosis due to exception %@\nPlease file a "
                             @"bug report to the BSG_KSCrash project.",
                             e];
    }
}

@end
